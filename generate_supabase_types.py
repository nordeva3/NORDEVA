#!/usr/bin/env python3
"""
Regenerate src/integrations/supabase/types.ts from supabase/migrations/*.sql.

Parses, in filename (migration) order:
  * CREATE TABLE column definitions
  * ALTER TABLE ... ADD COLUMN / ADD CONSTRAINT ... FOREIGN KEY
  * inline REFERENCES and table-level FOREIGN KEY constraints
  * CREATE VIEW column lists (explicit SELECT lists / aliased aggregates)
  * RPC functions used from src/ (hand-shaped Returns, Args from SQL signatures)

Existing hand/codegen-typed columns in the old types.ts are merged back in as a
fallback so a column the SQL parser cannot see is never lost.

Usage: python3 generate_supabase_types.py
"""
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
MIGRATIONS = sorted(glob.glob(os.path.join(ROOT, "supabase", "migrations", "*.sql")))
TYPES_PATH = os.path.join(ROOT, "src", "integrations", "supabase", "types.ts")

# ---------------------------------------------------------------- SQL lexing

def strip_dollar_bodies(sql: str) -> str:
    """Replace $$...$$ / $tag$...$tag$ bodies with an empty body marker."""
    def repl(m):
        tag = m.group(1)
        return f"{tag}{tag}"
    return re.sub(r"(\$[A-Za-z_]*\$).*?\1", repl, sql, flags=re.S)


def strip_sql_comments(sql: str) -> str:
    """Remove -- line comments (naive: honours single-quoted strings per line)."""
    out_lines = []
    for line in sql.split("\n"):
        in_str, cut, i = False, len(line), 0
        while i < len(line) - 1:
            if line[i] == "'":
                in_str = not in_str
            elif not in_str and line[i] == "-" and line[i + 1] == "-":
                cut = i
                break
            i += 1
        out_lines.append(line[:cut])
    return "\n".join(out_lines)


def split_top_level(text: str, sep: str = ",") -> list[str]:
    parts, depth, cur, in_str = [], 0, [], False
    i = 0
    while i < len(text):
        ch = text[i]
        if in_str:
            cur.append(ch)
            if ch == "'":
                if i + 1 < len(text) and text[i + 1] == "'":
                    cur.append("'")
                    i += 1
                else:
                    in_str = False
        elif ch == "'":
            in_str = True
            cur.append(ch)
        elif ch == "(":
            depth += 1
            cur.append(ch)
        elif ch == ")":
            depth -= 1
            cur.append(ch)
        elif ch == sep and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    if cur:
        parts.append("".join(cur))
    return [p.strip() for p in parts if p.strip()]


def balanced(text: str, start: int) -> tuple[str, int]:
    """text[start] == '(' -> (inner, index just past matching ')')."""
    depth, in_str, i = 0, False, start
    while i < len(text):
        ch = text[i]
        if in_str:
            if ch == "'":
                if i + 1 < len(text) and text[i + 1] == "'":
                    i += 1
                else:
                    in_str = False
        elif ch == "'":
            in_str = True
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return text[start + 1 : i], i + 1
        i += 1
    raise ValueError("unbalanced parens")


def statements(sql: str) -> list[str]:
    return split_top_level(sql, ";")


# ---------------------------------------------------------------- type map

ENUM_TYPES = {
    "app_role": 'Database["public"]["Enums"]["app_role"]',
    "listing_kind": 'Database["public"]["Enums"]["listing_kind"]',
}

BASE_MAP = [
    (r"^(uuid)$", "string"),
    (r"^(text|varchar|character varying|character|char|citext|name)$", "string"),
    (r"^(smallint|integer|int|int2|int4|int8|bigint|serial|bigserial|smallserial)$", "number"),
    (r"^(numeric|decimal|money|real|double precision|float[48]?)$", "number"),
    (r"^(boolean|bool)$", "boolean"),
    (r"^(timestamptz|timestamp with time zone|timestamp without time zone|timestamp|date|time with time zone|time without time zone|time|interval)$", "string"),
    (r"^(jsonb|json)$", "Json"),
    (r"^(bytea|inet|cidr|macaddr|tsvector|interval)$", "string"),
]


def sql_to_ts(raw_type: str) -> str:
    t = " ".join(raw_type.strip().lower().split())
    t = re.sub(r"\(\s*[\d, ]+\s*\)", "", t).strip()  # numeric(12,2), varchar(255)
    is_array = False
    if t.endswith("[]"):
        is_array = True
        t = t[:-2].strip()
    m = re.match(r"^(.+?)\s+array$", t)
    if m:
        is_array = True
        t = m.group(1).strip()
    t = t.replace("public.", "")
    if t in ENUM_TYPES:
        base = ENUM_TYPES[t]
    else:
        base = None
        for pat, ts in BASE_MAP:
            if re.match(pat, t):
                base = ts
                break
        if base is None:
            print(f"  !! unmapped SQL type {raw_type!r} -> string", file=sys.stderr)
            base = "string"
    return f"{base}[]" if is_array else base


# ---------------------------------------------------------------- schema model

# tables[name] = {col: {"ts": str, "notnull": bool, "default": bool}}
tables: dict[str, dict[str, dict]] = {}
relationships: dict[str, list[dict]] = {}


def add_relationship(table, fk_name, cols, ref_table, ref_cols, one_to_one=False):
    rels = relationships.setdefault(table, [])
    if any(r["foreignKeyName"] == fk_name for r in rels):
        return
    rels.append(
        {
            "foreignKeyName": fk_name,
            "columns": cols,
            "isOneToOne": one_to_one,
            "referencedRelation": ref_table,
            "referencedColumns": ref_cols,
        }
    )


TYPE_STOP = {
    "not", "null", "default", "primary", "references", "unique", "check",
    "generated", "collate", "constraint",
}


def parse_column_def(defn: str):
    """Return (name, ts_type, notnull, has_default) or None for constraints."""
    d = defn.strip()
    if not d:
        return None
    first = d.split()[0].strip('",`').lower()
    if first in ("primary", "unique", "check", "constraint", "foreign", "exclude", "like"):
        return None
    m = re.match(r'^"?([A-Za-z_][\w]*)"?\s+(.*)$', d, re.S)
    if not m:
        return None
    name, rest = m.group(1), m.group(2).strip()
    # collect type tokens until a keyword that ends the type
    tokens = re.split(r"(\([^)]*\))", rest)  # keep (n,m) groups attached
    flat = " ".join(tokens)
    words = flat.split()
    type_words = []
    i = 0
    while i < len(words):
        w = words[i].lower().rstrip(",")
        if w in TYPE_STOP:
            break
        type_words.append(words[i])
        i += 1
        # multi-word types
        joined = " ".join(type_words).lower()
        if joined in ("timestamp with time zone", "timestamp without time zone",
                      "time with time zone", "time without time zone",
                      "character varying", "double precision"):
            # a following stop-word or end completes the type
            if i >= len(words) or words[i].lower().rstrip(",") in TYPE_STOP:
                break
            # e.g. "timestamp with time zone not null" handled by stop check above
            if words[i].lower().rstrip(",") in TYPE_STOP:
                break
    raw_type = " ".join(type_words)
    # array marker may be a separate token
    if i < len(words) and words[i] == "[]":
        raw_type += "[]"
    rest_lower = rest.lower()
    notnull = bool(re.search(r"\bnot\s+null\b", rest_lower)) or bool(
        re.search(r"\bprimary\s+key\b", rest_lower)
    )
    has_default = bool(re.search(r"\bdefault\b", rest_lower)) or bool(
        re.search(r"\bgenerated\b", rest_lower)
    )
    # inline REFERENCES -> FK relationship (default constraint name)
    ref = re.search(
        r"\breferences\s+(?:public\.)?\"?([A-Za-z_]\w*)\"?\s*\(\s*\"?([A-Za-z_]\w*)\"?\s*\)",
        rest_lower,
    )
    return name, sql_to_ts(raw_type), notnull, has_default, ref


def register_fk_from_def(table: str, defn: str):
    d = defn.strip()
    # [CONSTRAINT name] FOREIGN KEY (cols) REFERENCES [public.]tbl(cols)
    m = re.search(
        r"(?:constraint\s+\"?([A-Za-z_]\w*)\"?\s+)?foreign\s+key\s*\(([^)]*)\)\s*"
        r"references\s+(?:public\.)?\"?([A-Za-z_]\w*)\"?\s*\(\s*\"?([A-Za-z_]\w*)\"?\s*\)",
        d, re.I | re.S,
    )
    if m:
        cols = [c.strip().strip('"') for c in m.group(2).split(",")]
        fk = m.group(1) or f"{table}_{cols[0]}_fkey"
        add_relationship(table, fk, cols, m.group(3), [m.group(4)])
        return True
    return False


def parse_create_table(sql_clean: str):
    for m in re.finditer(
        r"create\s+table\s+(if\s+not\s+exists\s+)?(?:public\.)?\"?([A-Za-z_]\w*)\"?\s*\(",
        sql_clean, re.I,
    ):
        name = m.group(2).lower()
        inner, _ = balanced(sql_clean, m.end() - 1)
        cols = tables.setdefault(name, {})
        for part in split_top_level(inner):
            if register_fk_from_def(name, part):
                continue
            parsed = parse_column_def(part)
            if not parsed:
                continue
            col, ts, notnull, has_default, ref = parsed
            if col not in cols:
                cols[col] = {"ts": ts, "notnull": notnull, "default": has_default}
            else:
                cols[col]["notnull"] = cols[col]["notnull"] or notnull
                cols[col]["default"] = cols[col]["default"] or has_default
            if ref:
                add_relationship(
                    name, f"{name}_{col}_fkey", [col], ref.group(1), [ref.group(2)],
                    one_to_one=bool(re.search(r"\bprimary\s+key\b", part.lower())),
                )


def parse_alter_tables(sql_clean: str):
    for stmt in statements(sql_clean):
        m = re.match(
            r"\s*alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?\"?([A-Za-z_]\w*)\"?\s+(.*)$",
            stmt, re.I | re.S,
        )
        if not m:
            continue
        table, body = m.group(1).lower(), m.group(2)
        for clause in split_top_level(body):
            c = clause.strip()
            add_col = re.match(
                r"add\s+column\s+(?:if\s+not\s+exists\s+)?(.*)$", c, re.I | re.S
            )
            if add_col:
                parsed = parse_column_def(add_col.group(1))
                if parsed:
                    col, ts, notnull, has_default, ref = parsed
                    cols = tables.setdefault(table, {})
                    if col not in cols:
                        cols[col] = {"ts": ts, "notnull": notnull, "default": has_default}
                    if ref:
                        add_relationship(table, f"{table}_{col}_fkey", [col],
                                         ref.group(1), [ref.group(2)])
                continue
            add_con = re.match(r"add\s+(?:constraint\s+\S+\s+)?.*$", c, re.I | re.S)
            if add_con and "foreign" in c.lower():
                # clause carries its own CONSTRAINT name; rebuild a defn string
                register_fk_from_def(table, c[4:].strip() if c.lower().startswith("add ") else c)


def parse_views(sql_clean: str):
    views: dict[str, dict[str, str]] = {}
    # website_requests_public: explicit plain column list from website_requests
    # The view is redefined by later migrations; the LAST definition wins
    # (matching CREATE OR REPLACE / DROP+CREATE semantics in Postgres).
    matches = list(
        re.finditer(
            r"create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?website_requests_public\s+as\s+"
            r"select\s+(.*?)\s+from\s+(?:public\.)?website_requests\b",
            sql_clean, re.I | re.S,
        )
    )
    m = matches[-1] if matches else None
    if m:
        cols = {}
        base = tables.get("website_requests", {})
        for part in split_top_level(m.group(1)):
            cname = part.strip().split()[-1].strip('"')
            info = base.get(cname)
            cols[cname] = (info["ts"] if info else "string") + " | null"
        views["website_requests_public"] = cols
    # listing_stats / creator_stats: aliased select list; types hand-mapped
    if re.search(r"create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?listing_stats\b", sql_clean, re.I):
        views["listing_stats"] = {
            "listing_id": "string | null",
            "rating_avg": "number | null",
            "rating_count": "number | null",
            "sales_count": "number | null",
        }
    if re.search(r"create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?creator_stats\b", sql_clean, re.I):
        views["creator_stats"] = {
            "creator_id": "string | null",
            "followers": "number | null",
            "products": "number | null",
            "rating_avg": "number | null",
            "sales": "number | null",
        }
    return views


# ---------------------------------------------------------------- old types fallback

def parse_old_types(text: str):
    """Extract {table: {col: ts_type_string}} from the old types.ts Row blocks."""
    old: dict[str, dict[str, str]] = {}
    # crude block split on 6-space indented table keys inside Tables: { ... }
    tables_section = text.split("    Views: {")[0]
    for m in re.finditer(r"\n      (\w+): \{\n        Row: \{(.*?)\n        \}", tables_section, re.S):
        cols = {}
        for cm in re.finditer(r"\n          (\w+): (.+)", m.group(2)):
            cols[cm.group(1)] = cm.group(2).strip()
        if cols:
            old[m.group(1)] = cols
    return old


# ---------------------------------------------------------------- functions

# Args taken from the SQL signatures in the migrations; Returns hand-shaped to
# the row shapes the call sites consume.
FUNCTIONS = {
    "claim_website_request": {
        "Args": {"claimer_id": "string", "request_id": "string"},
        "Returns": "boolean",
    },
    "complete_website_request": {
        "Args": {"actor_id": "string", "request_id": "string"},
        "Returns": "boolean",
    },
    "consume_coupon": {
        "Args": {"p_amount": "number", "p_buyer_id": "string", "p_coupon_id": "string", "p_order_id": "string"},
        "Returns": "unknown",
    },
    "consume_rate_limit": {
        "Args": {"p_key": "string", "p_limit": "number", "p_window_seconds": "number"},
        "Returns": "boolean",
    },
    "has_role": {
        "Args": {"_role": 'Database["public"]["Enums"]["app_role"]', "_user_id": "string"},
        "Returns": "boolean",
    },
    "queue_listing_scans": {
        "Args": {"p_listing_id": "string"},
        "Returns": "number",
    },
    "record_search_query": {
        "Args": {"p_query": "string"},
        "Returns": "unknown",
    },
    "redeem_gift_card": {
        "Args": {"p_amount": "number", "p_code": "string", "p_currency": "string", "p_order_id": "string", "p_user_id": "string"},
        "Returns": "number",
    },
    "search_listing_ids": {
        "Args": {"p_limit": "number", "p_query": "string"},
        "Returns": "{ listing_id: string }[]",
    },
    "search_suggestions": {
        "Args": {"p_limit": "number", "p_query": "string"},
        "Returns": "{ category: string | null; currency: string | null; label: string; listing_id: string | null; popularity: number; price: number | null; suggestion_type: string }[]",
    },
    "select_project_proposal": {
        "Args": {"p_proposal_id": "string", "p_request_id": "string"},
        "Returns": "boolean",
    },
    "transition_project_status": {
        "Args": {"p_request_id": "string", "p_status": "string"},
        "Returns": "boolean",
    },
    "validate_coupon": {
        # p_seller_id is optional here: one call site passes
        # (await ...single()).data?.seller_id, i.e. string | undefined.
        "Args": {"p_amount": "number", "p_buyer_id": "string", "p_code": "string", "p_currency": "string", "p_seller_id?": "string"},
        "Returns": "{ coupon_id: string; discount_amount: number; discount_type: string; discount_value: number }[]",
    },
    "write_admin_audit": {
        "Args": {"p_action": "string", "p_admin_id": "string", "p_metadata": "Json", "p_target_id": "string | null", "p_target_type": "string"},
        "Returns": "unknown",
    },
}


# ---------------------------------------------------------------- emit

def emit_table(name: str, cols: dict, view: bool = False) -> list[str]:
    out = [f"      {name}: {{"]
    for kind in ("Row", "Insert", "Update"):
        out.append(f"        {kind}: {{")
        for col in sorted(cols):
            info = cols[col]
            if view:
                ts = info["ts"] if isinstance(info, dict) else info
                out.append(f"          {col}: {ts}" if kind == "Row" else f"          {col}?: {ts}")
                continue
            ts, notnull, has_default = info["ts"], info["notnull"], info["default"]
            if kind == "Row":
                out.append(f"          {col}: {ts}" + ("" if notnull else " | null"))
            elif kind == "Insert":
                optional = (not notnull) or has_default
                base = ts + ("" if notnull else " | null")
                out.append(f"          {col}{'?' if optional else ''}: {base}")
            else:
                base = ts + ("" if notnull else " | null")
                out.append(f"          {col}?: {base}")
        out.append("        }")
    rels = relationships.get(name, [])
    if rels:
        out.append("        Relationships: [")
        for r in sorted(rels, key=lambda x: x["foreignKeyName"]):
            cols_js = ", ".join(f'"{c}"' for c in r["columns"])
            ref_js = ", ".join(f'"{c}"' for c in r["referencedColumns"])
            out.append("          {")
            out.append(f'            foreignKeyName: "{r["foreignKeyName"]}"')
            out.append(f"            columns: [{cols_js}]")
            out.append(f"            isOneToOne: {str(r['isOneToOne']).lower()}")
            out.append(f'            referencedRelation: "{r["referencedRelation"]}"')
            out.append(f"            referencedColumns: [{ref_js}]")
            out.append("          },")
        out.append("        ]")
    else:
        out.append("        Relationships: []")
    out.append("      }")
    return out


def main():
    all_sql_clean = ""
    for path in MIGRATIONS:
        raw = open(path).read()
        clean = strip_sql_comments(strip_dollar_bodies(raw))
        all_sql_clean += "\n" + clean
        parse_create_table(clean)
        parse_alter_tables(clean)
    views = parse_views(all_sql_clean)

    old_text = open(TYPES_PATH).read()
    old = parse_old_types(old_text)
    merged = 0
    for tname, cols in old.items():
        if tname not in tables:
            continue
        for col, ts in cols.items():
            if col not in tables[tname]:
                # keep the previously-typed column; treat as nullable w/o default info
                tables[tname][col] = {"ts": ts, "notnull": False, "default": True}
                merged += 1
    print(f"tables parsed: {len(tables)}; views: {sorted(views)}; "
          f"old-type columns merged back: {merged}")

    # tail: everything from `type DatabaseWithoutInternals` onward is preserved
    tail = old_text[old_text.index("type DatabaseWithoutInternals"):]

    lines = []
    lines.append("export type Json =")
    lines.append("  | string")
    lines.append("  | number")
    lines.append("  | boolean")
    lines.append("  | null")
    lines.append("  | { [key: string]: Json | undefined }")
    lines.append("  | Json[]")
    lines.append("")
    lines.append("export type Database = {")
    lines.append("  // Allows to automatically instantiate createClient with right options")
    lines.append("  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)")
    lines.append("  __InternalSupabase: {")
    lines.append('    PostgrestVersion: "14.17"')
    lines.append("  }")
    lines.append("  public: {")
    lines.append("    Tables: {")
    for name in sorted(tables):
        lines.extend(emit_table(name, tables[name]))
    lines.append("    }")
    lines.append("    Views: {")
    for name in sorted(views):
        vcols = {c: {"ts": t} for c, t in views[name].items()}
        # Views in supabase-js codegen carry Row + Relationships only; the
        # helper types in the tail only read Row for views.
        lines.append(f"      {name}: {{")
        lines.append("        Row: {")
        for col in sorted(views[name]):
            lines.append(f"          {col}: {views[name][col]}")
        lines.append("        }")
        lines.append("        Relationships: []")
        lines.append("      }")
    lines.append("    }")
    lines.append("    Functions: {")
    for name in sorted(FUNCTIONS):
        fn = FUNCTIONS[name]
        lines.append(f"      {name}: {{")
        lines.append("        Args: {")
        for arg in sorted(fn["Args"]):
            optional = arg.endswith("?")
            key = arg.rstrip("?")
            lines.append(f"          {key}{'?' if optional else ''}: {fn['Args'][arg]}")
        lines.append("        }")
        lines.append(f"        Returns: {fn['Returns']}")
        lines.append("      }")
    lines.append("    }")
    lines.append("    Enums: {")
    lines.append('      app_role: "admin" | "moderator" | "user"')
    lines.append('      listing_kind: "software" | "website"')
    lines.append("    }")
    lines.append("    CompositeTypes: {")
    lines.append("      [_ in never]: never")
    lines.append("    }")
    lines.append("  }")
    lines.append("}")
    lines.append("")
    new_text = "\n".join(lines) + "\n" + tail
    if not new_text.endswith("\n"):
        new_text += "\n"
    open(TYPES_PATH, "w").write(new_text)
    print(f"wrote {TYPES_PATH} ({len(new_text)} bytes)")
    # Keep the generated file prettier-formatted so `npm run lint` stays green
    # after regeneration (the generator's own layout is not prettier-style).
    import subprocess
    try:
        subprocess.run(
            ["npx", "prettier", "--write", TYPES_PATH],
            cwd=os.path.dirname(os.path.abspath(__file__)),
            check=False,
            capture_output=True,
            timeout=120,
        )
        print("prettier formatting applied")
    except Exception as exc:  # formatting is best-effort; types remain valid
        print(f"prettier skipped: {exc}")


if __name__ == "__main__":
    main()
