export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17";
  };
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string;
          admin_id: string;
          created_at: string;
          id: string;
          metadata: Json;
          target_id: string | null;
          target_type: string;
        };
        Insert: {
          action: string;
          admin_id: string;
          created_at?: string;
          id?: string;
          metadata?: Json;
          target_id?: string | null;
          target_type: string;
        };
        Update: {
          action?: string;
          admin_id?: string;
          created_at?: string;
          id?: string;
          metadata?: Json;
          target_id?: string | null;
          target_type?: string;
        };
        Relationships: [];
      };
      admin_tasks: {
        Row: {
          assigned_to: string | null;
          created_at: string;
          id: string;
          metadata: Json;
          priority: string;
          status: string;
          target_id: string | null;
          task_type: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          priority?: string;
          status?: string;
          target_id?: string | null;
          task_type: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          priority?: string;
          status?: string;
          target_id?: string | null;
          task_type?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      admin_user_controls: {
        Row: {
          note: string | null;
          state: string;
          updated_at: string;
          updated_by: string | null;
          user_id: string;
        };
        Insert: {
          note?: string | null;
          state?: string;
          updated_at?: string;
          updated_by?: string | null;
          user_id: string;
        };
        Update: {
          note?: string | null;
          state?: string;
          updated_at?: string;
          updated_by?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      affiliate_programs: {
        Row: {
          active: boolean;
          commission_percent: number;
          created_at: string;
          id: string;
          seller_id: string;
        };
        Insert: {
          active?: boolean;
          commission_percent?: number;
          created_at?: string;
          id?: string;
          seller_id: string;
        };
        Update: {
          active?: boolean;
          commission_percent?: number;
          created_at?: string;
          id?: string;
          seller_id?: string;
        };
        Relationships: [];
      };
      affiliate_referrals: {
        Row: {
          affiliate_id: string;
          click_id: string | null;
          commission_amount: number;
          created_at: string;
          id: string;
          order_id: string | null;
          program_id: string;
          status: string;
        };
        Insert: {
          affiliate_id: string;
          click_id?: string | null;
          commission_amount?: number;
          created_at?: string;
          id?: string;
          order_id?: string | null;
          program_id: string;
          status?: string;
        };
        Update: {
          affiliate_id?: string;
          click_id?: string | null;
          commission_amount?: number;
          created_at?: string;
          id?: string;
          order_id?: string | null;
          program_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "affiliate_referrals_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "affiliate_referrals_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "affiliate_programs";
            referencedColumns: ["id"];
          },
        ];
      };
      analytics_events: {
        Row: {
          created_at: string;
          event_name: string;
          id: number;
          listing_id: string | null;
          metadata: Json;
          path: string | null;
          referrer: string | null;
          session_id: string | null;
          user_id: string | null;
          utm_campaign: string | null;
          utm_medium: string | null;
          utm_source: string | null;
        };
        Insert: {
          created_at?: string;
          event_name: string;
          id?: number;
          listing_id?: string | null;
          metadata?: Json;
          path?: string | null;
          referrer?: string | null;
          session_id?: string | null;
          user_id?: string | null;
          utm_campaign?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
        };
        Update: {
          created_at?: string;
          event_name?: string;
          id?: number;
          listing_id?: string | null;
          metadata?: Json;
          path?: string | null;
          referrer?: string | null;
          session_id?: string | null;
          user_id?: string | null;
          utm_campaign?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "analytics_events_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      api_keys: {
        Row: {
          created_at: string;
          id: string;
          key_hash: string;
          key_prefix: string;
          last_used_at: string | null;
          name: string;
          revoked_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          key_hash: string;
          key_prefix: string;
          last_used_at?: string | null;
          name: string;
          revoked_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          key_hash?: string;
          key_prefix?: string;
          last_used_at?: string | null;
          name?: string;
          revoked_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      cart_items: {
        Row: {
          created_at: string;
          id: string;
          listing_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          listing_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          listing_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cart_items_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          created_at: string;
          icon: string | null;
          id: string;
          is_active: boolean;
          name: string;
          parent_id: string | null;
          slug: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          icon?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          parent_id?: string | null;
          slug: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          icon?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          parent_id?: string | null;
          slug?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      collection_items: {
        Row: {
          collection_id: string;
          listing_id: string;
          sort_order: number;
        };
        Insert: {
          collection_id: string;
          listing_id: string;
          sort_order?: number;
        };
        Update: {
          collection_id?: string;
          listing_id?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "collection_items_collection_id_fkey";
            columns: ["collection_id"];
            isOneToOne: false;
            referencedRelation: "collections";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "collection_items_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      collections: {
        Row: {
          cover_url: string | null;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          owner_id: string | null;
          slug: string;
          visibility: string;
        };
        Insert: {
          cover_url?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          owner_id?: string | null;
          slug: string;
          visibility?: string;
        };
        Update: {
          cover_url?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          owner_id?: string | null;
          slug?: string;
          visibility?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          buyer_id: string;
          created_at: string;
          id: string;
          last_message_at: string;
          listing_id: string | null;
          seller_id: string;
        };
        Insert: {
          buyer_id: string;
          created_at?: string;
          id?: string;
          last_message_at?: string;
          listing_id?: string | null;
          seller_id: string;
        };
        Update: {
          buyer_id?: string;
          created_at?: string;
          id?: string;
          last_message_at?: string;
          listing_id?: string | null;
          seller_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      coupon_redemptions: {
        Row: {
          amount: number;
          buyer_id: string;
          coupon_id: string;
          created_at: string;
          id: string;
          order_id: string | null;
        };
        Insert: {
          amount: number;
          buyer_id: string;
          coupon_id: string;
          created_at?: string;
          id?: string;
          order_id?: string | null;
        };
        Update: {
          amount?: number;
          buyer_id?: string;
          coupon_id?: string;
          created_at?: string;
          id?: string;
          order_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey";
            columns: ["coupon_id"];
            isOneToOne: false;
            referencedRelation: "coupons";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coupon_redemptions_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      coupons: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          currency: string | null;
          discount_type: string;
          discount_value: number;
          expires_at: string | null;
          id: string;
          max_redemptions: number | null;
          min_order_amount: number | null;
          redeemed_count: number;
          seller_id: string | null;
          starts_at: string | null;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          currency?: string | null;
          discount_type: string;
          discount_value: number;
          expires_at?: string | null;
          id?: string;
          max_redemptions?: number | null;
          min_order_amount?: number | null;
          redeemed_count?: number;
          seller_id?: string | null;
          starts_at?: string | null;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          currency?: string | null;
          discount_type?: string;
          discount_value?: number;
          expires_at?: string | null;
          id?: string;
          max_redemptions?: number | null;
          min_order_amount?: number | null;
          redeemed_count?: number;
          seller_id?: string | null;
          starts_at?: string | null;
        };
        Relationships: [];
      };
      email_outbox: {
        Row: {
          attempts: number;
          available_at: string;
          created_at: string;
          id: string;
          last_error: string | null;
          payload: Json;
          provider_message_id: string | null;
          recipient_email: string;
          sent_at: string | null;
          status: string;
          subject: string;
          template_key: string;
        };
        Insert: {
          attempts?: number;
          available_at?: string;
          created_at?: string;
          id?: string;
          last_error?: string | null;
          payload?: Json;
          provider_message_id?: string | null;
          recipient_email: string;
          sent_at?: string | null;
          status?: string;
          subject: string;
          template_key: string;
        };
        Update: {
          attempts?: number;
          available_at?: string;
          created_at?: string;
          id?: string;
          last_error?: string | null;
          payload?: Json;
          provider_message_id?: string | null;
          recipient_email?: string;
          sent_at?: string | null;
          status?: string;
          subject?: string;
          template_key?: string;
        };
        Relationships: [];
      };
      follows: {
        Row: {
          created_at: string;
          creator_id: string;
          follower_id: string;
          id: string;
        };
        Insert: {
          created_at?: string;
          creator_id: string;
          follower_id: string;
          id?: string;
        };
        Update: {
          created_at?: string;
          creator_id?: string;
          follower_id?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "follows_creator_id_fkey";
            columns: ["creator_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      gift_card_transactions: {
        Row: {
          amount: number;
          created_at: string;
          currency: string;
          gift_card_id: string;
          id: string;
          note: string | null;
          order_id: string | null;
          transaction_type: string;
          user_id: string | null;
        };
        Insert: {
          amount: number;
          created_at?: string;
          currency: string;
          gift_card_id: string;
          id?: string;
          note?: string | null;
          order_id?: string | null;
          transaction_type: string;
          user_id?: string | null;
        };
        Update: {
          amount?: number;
          created_at?: string;
          currency?: string;
          gift_card_id?: string;
          id?: string;
          note?: string | null;
          order_id?: string | null;
          transaction_type?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "gift_card_transactions_gift_card_id_fkey";
            columns: ["gift_card_id"];
            isOneToOne: false;
            referencedRelation: "gift_cards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gift_card_transactions_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      gift_cards: {
        Row: {
          active: boolean;
          buyer_id: string | null;
          code: string;
          created_at: string;
          currency: string;
          expires_at: string | null;
          id: string;
          initial_amount: number;
          recipient_email: string | null;
          remaining_amount: number;
        };
        Insert: {
          active?: boolean;
          buyer_id?: string | null;
          code: string;
          created_at?: string;
          currency?: string;
          expires_at?: string | null;
          id?: string;
          initial_amount: number;
          recipient_email?: string | null;
          remaining_amount: number;
        };
        Update: {
          active?: boolean;
          buyer_id?: string | null;
          code?: string;
          created_at?: string;
          currency?: string;
          expires_at?: string | null;
          id?: string;
          initial_amount?: number;
          recipient_email?: string | null;
          remaining_amount?: number;
        };
        Relationships: [];
      };
      license_keys: {
        Row: {
          buyer_id: string;
          created_at: string;
          expires_at: string | null;
          id: string;
          last_used_at: string | null;
          license_key: string;
          listing_id: string;
          order_id: string | null;
          seats: number;
          status: string;
          used_seats: number;
        };
        Insert: {
          buyer_id: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          last_used_at?: string | null;
          license_key: string;
          listing_id: string;
          order_id?: string | null;
          seats?: number;
          status?: string;
          used_seats?: number;
        };
        Update: {
          buyer_id?: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          last_used_at?: string | null;
          license_key?: string;
          listing_id?: string;
          order_id?: string | null;
          seats?: number;
          status?: string;
          used_seats?: number;
        };
        Relationships: [
          {
            foreignKeyName: "license_keys_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "license_keys_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_assets: {
        Row: {
          asset_kind: string;
          checksum_sha256: string | null;
          created_at: string;
          file_name: string;
          file_size: number | null;
          id: string;
          listing_id: string;
          mime_type: string | null;
          sort_order: number;
          storage_path: string;
        };
        Insert: {
          asset_kind?: string;
          checksum_sha256?: string | null;
          created_at?: string;
          file_name: string;
          file_size?: number | null;
          id?: string;
          listing_id: string;
          mime_type?: string | null;
          sort_order?: number;
          storage_path: string;
        };
        Update: {
          asset_kind?: string;
          checksum_sha256?: string | null;
          created_at?: string;
          file_name?: string;
          file_size?: number | null;
          id?: string;
          listing_id?: string;
          mime_type?: string | null;
          sort_order?: number;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listing_assets_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_faq: {
        Row: {
          answer: string;
          created_at: string;
          id: string;
          listing_id: string;
          question: string;
          sort_order: number;
        };
        Insert: {
          answer: string;
          created_at?: string;
          id?: string;
          listing_id: string;
          question: string;
          sort_order?: number;
        };
        Update: {
          answer?: string;
          created_at?: string;
          id?: string;
          listing_id?: string;
          question?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "listing_faq_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_media: {
        Row: {
          alt_text: string | null;
          created_at: string;
          external_url: string | null;
          id: string;
          listing_id: string;
          media_type: string;
          sort_order: number;
          storage_path: string | null;
          title: string | null;
        };
        Insert: {
          alt_text?: string | null;
          created_at?: string;
          external_url?: string | null;
          id?: string;
          listing_id: string;
          media_type: string;
          sort_order?: number;
          storage_path?: string | null;
          title?: string | null;
        };
        Update: {
          alt_text?: string | null;
          created_at?: string;
          external_url?: string | null;
          id?: string;
          listing_id?: string;
          media_type?: string;
          sort_order?: number;
          storage_path?: string | null;
          title?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "listing_media_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_moderation_events: {
        Row: {
          action: string;
          admin_id: string | null;
          created_at: string;
          id: string;
          listing_id: string;
          metadata: Json;
          note: string | null;
        };
        Insert: {
          action: string;
          admin_id?: string | null;
          created_at?: string;
          id?: string;
          listing_id: string;
          metadata?: Json;
          note?: string | null;
        };
        Update: {
          action?: string;
          admin_id?: string | null;
          created_at?: string;
          id?: string;
          listing_id?: string;
          metadata?: Json;
          note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "listing_moderation_events_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_private_delivery: {
        Row: {
          content_ciphertext: string | null;
          created_at: string;
          files: Json;
          id: string;
          listing_id: string;
          updated_at: string;
        };
        Insert: {
          content_ciphertext?: string | null;
          created_at?: string;
          files?: Json;
          id?: string;
          listing_id: string;
          updated_at?: string;
        };
        Update: {
          content_ciphertext?: string | null;
          created_at?: string;
          files?: Json;
          id?: string;
          listing_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listing_private_delivery_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_product_details: {
        Row: {
          activation_limit: number | null;
          ai_details: string | null;
          ai_used: boolean;
          assets_confirmed: boolean;
          changelog: string | null;
          created_at: string;
          documentation_url: string | null;
          features: Json;
          file_formats: Json;
          included_items: Json;
          languages: Json;
          last_updated: string | null;
          legal_confirmed: boolean;
          license_duration_days: number | null;
          license_seats: number;
          license_type: string;
          listing_id: string;
          minimum_price: number | null;
          pay_what_you_want: boolean;
          platforms: Json;
          pricing_model: string;
          product_type: string;
          quality_score: number;
          release_date: string | null;
          requirements: string | null;
          rights_confirmed: boolean;
          seo_description: string | null;
          seo_keywords: Json;
          seo_title: string | null;
          short_description: string | null;
          subcategory: string | null;
          support_url: string | null;
          tags: Json;
          target_audience: string | null;
          tax_category: string | null;
          tech_stack: Json;
          trial_days: number;
          updated_at: string;
          version: string | null;
        };
        Insert: {
          activation_limit?: number | null;
          ai_details?: string | null;
          ai_used?: boolean;
          assets_confirmed?: boolean;
          changelog?: string | null;
          created_at?: string;
          documentation_url?: string | null;
          features?: Json;
          file_formats?: Json;
          included_items?: Json;
          languages?: Json;
          last_updated?: string | null;
          legal_confirmed?: boolean;
          license_duration_days?: number | null;
          license_seats?: number;
          license_type?: string;
          listing_id: string;
          minimum_price?: number | null;
          pay_what_you_want?: boolean;
          platforms?: Json;
          pricing_model?: string;
          product_type?: string;
          quality_score?: number;
          release_date?: string | null;
          requirements?: string | null;
          rights_confirmed?: boolean;
          seo_description?: string | null;
          seo_keywords?: Json;
          seo_title?: string | null;
          short_description?: string | null;
          subcategory?: string | null;
          support_url?: string | null;
          tags?: Json;
          target_audience?: string | null;
          tax_category?: string | null;
          tech_stack?: Json;
          trial_days?: number;
          updated_at?: string;
          version?: string | null;
        };
        Update: {
          activation_limit?: number | null;
          ai_details?: string | null;
          ai_used?: boolean;
          assets_confirmed?: boolean;
          changelog?: string | null;
          created_at?: string;
          documentation_url?: string | null;
          features?: Json;
          file_formats?: Json;
          included_items?: Json;
          languages?: Json;
          last_updated?: string | null;
          legal_confirmed?: boolean;
          license_duration_days?: number | null;
          license_seats?: number;
          license_type?: string;
          listing_id?: string;
          minimum_price?: number | null;
          pay_what_you_want?: boolean;
          platforms?: Json;
          pricing_model?: string;
          product_type?: string;
          quality_score?: number;
          release_date?: string | null;
          requirements?: string | null;
          rights_confirmed?: boolean;
          seo_description?: string | null;
          seo_keywords?: Json;
          seo_title?: string | null;
          short_description?: string | null;
          subcategory?: string | null;
          support_url?: string | null;
          tags?: Json;
          target_audience?: string | null;
          tax_category?: string | null;
          tech_stack?: Json;
          trial_days?: number;
          updated_at?: string;
          version?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "listing_product_details_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: true;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_versions: {
        Row: {
          created_at: string;
          id: string;
          listing_id: string;
          notes: string | null;
          version: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          listing_id: string;
          notes?: string | null;
          version: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          listing_id?: string;
          notes?: string | null;
          version?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listing_versions_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_views: {
        Row: {
          created_at: string;
          id: string;
          listing_id: string;
          viewer_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          listing_id: string;
          viewer_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          listing_id?: string;
          viewer_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "listing_views_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      listings: {
        Row: {
          category: string | null;
          cover_url: string | null;
          created_at: string;
          currency: string;
          demo_url: string | null;
          description: string;
          docs_url: string | null;
          file_name: string | null;
          file_path: string | null;
          file_size: number | null;
          id: string;
          kind: Database["public"]["Enums"]["listing_kind"];
          price: number;
          review_note: string | null;
          sales_count: number;
          screenshots: string[];
          seller_id: string;
          status: string;
          tags: string[];
          title: string;
          version: string | null;
          views_count: number;
        };
        Insert: {
          category?: string | null;
          cover_url?: string | null;
          created_at?: string;
          currency?: string;
          demo_url?: string | null;
          description: string;
          docs_url?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          file_size?: number | null;
          id?: string;
          kind: Database["public"]["Enums"]["listing_kind"];
          price: number;
          review_note?: string | null;
          sales_count?: number;
          screenshots?: string[];
          seller_id: string;
          status?: string;
          tags?: string[];
          title: string;
          version?: string | null;
          views_count?: number;
        };
        Update: {
          category?: string | null;
          cover_url?: string | null;
          created_at?: string;
          currency?: string;
          demo_url?: string | null;
          description?: string;
          docs_url?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          file_size?: number | null;
          id?: string;
          kind?: Database["public"]["Enums"]["listing_kind"];
          price?: number;
          review_note?: string | null;
          sales_count?: number;
          screenshots?: string[];
          seller_id?: string;
          status?: string;
          tags?: string[];
          title?: string;
          version?: string | null;
          views_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "listings_seller_id_fkey";
            columns: ["seller_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listings_seller_public_fkey";
            columns: ["seller_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      malware_scans: {
        Row: {
          asset_id: string | null;
          findings: Json | null;
          id: string;
          listing_id: string | null;
          scanned_at: string;
          scanner: string;
          scanner_version: string | null;
          signature: string | null;
          status: string;
        };
        Insert: {
          asset_id?: string | null;
          findings?: Json | null;
          id?: string;
          listing_id?: string | null;
          scanned_at?: string;
          scanner: string;
          scanner_version?: string | null;
          signature?: string | null;
          status: string;
        };
        Update: {
          asset_id?: string | null;
          findings?: Json | null;
          id?: string;
          listing_id?: string | null;
          scanned_at?: string;
          scanner?: string;
          scanner_version?: string | null;
          signature?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "malware_scans_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "listing_assets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "malware_scans_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      security_events: {
        Row: {
          actor_id: string | null;
          asset_id: string | null;
          created_at: string;
          detail: Json;
          event_type: string;
          id: string;
          listing_id: string | null;
          scan_id: string | null;
        };
        Insert: {
          actor_id?: string | null;
          asset_id?: string | null;
          created_at?: string;
          detail?: Json;
          event_type: string;
          id?: string;
          listing_id?: string | null;
          scan_id?: string | null;
        };
        Update: {
          actor_id?: string | null;
          asset_id?: string | null;
          created_at?: string;
          detail?: Json;
          event_type?: string;
          id?: string;
          listing_id?: string | null;
          scan_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "security_events_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "listing_assets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "security_events_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "security_events_scan_id_fkey";
            columns: ["scan_id"];
            isOneToOne: false;
            referencedRelation: "malware_scans";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          body: string;
          conversation_id: string;
          created_at: string;
          id: string;
          read_at: string | null;
          sender_id: string;
        };
        Insert: {
          body: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          read_at?: string | null;
          sender_id: string;
        };
        Update: {
          body?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          read_at?: string | null;
          sender_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      newsletter_subscribers: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      notification_preferences: {
        Row: {
          marketing_emails: boolean;
          messages: boolean;
          order_emails: boolean;
          product_updates: boolean;
          security_alerts: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          marketing_emails?: boolean;
          messages?: boolean;
          order_emails?: boolean;
          product_updates?: boolean;
          security_alerts?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          marketing_emails?: boolean;
          messages?: boolean;
          order_emails?: boolean;
          product_updates?: boolean;
          security_alerts?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          href: string | null;
          id: string;
          read: boolean;
          title: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          href?: string | null;
          id?: string;
          read?: boolean;
          title: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          href?: string | null;
          id?: string;
          read?: boolean;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          amount: number;
          buyer_country: string | null;
          buyer_email: string;
          buyer_id: string | null;
          coupon_id: string | null;
          created_at: string;
          currency: string;
          discount_amount: number;
          gross_amount: number | null;
          id: string;
          listing_id: string;
          paid_at: string | null;
          payment_status: string;
          platform_fee: number;
          provider: string | null;
          provider_checkout_id: string | null;
          provider_order_id: string | null;
          provider_payment_id: string | null;
          seller_earnings: number;
          seller_id: string;
          status: string;
          tax_amount: number;
          variant_id: string | null;
        };
        Insert: {
          amount: number;
          buyer_country?: string | null;
          buyer_email: string;
          buyer_id?: string | null;
          coupon_id?: string | null;
          created_at?: string;
          currency: string;
          discount_amount?: number;
          gross_amount?: number | null;
          id?: string;
          listing_id: string;
          paid_at?: string | null;
          payment_status?: string;
          platform_fee: number;
          provider?: string | null;
          provider_checkout_id?: string | null;
          provider_order_id?: string | null;
          provider_payment_id?: string | null;
          seller_earnings: number;
          seller_id: string;
          status?: string;
          tax_amount?: number;
          variant_id?: string | null;
        };
        Update: {
          amount?: number;
          buyer_country?: string | null;
          buyer_email?: string;
          buyer_id?: string | null;
          coupon_id?: string | null;
          created_at?: string;
          currency?: string;
          discount_amount?: number;
          gross_amount?: number | null;
          id?: string;
          listing_id?: string;
          paid_at?: string | null;
          payment_status?: string;
          platform_fee?: number;
          provider?: string | null;
          provider_checkout_id?: string | null;
          provider_order_id?: string | null;
          provider_payment_id?: string | null;
          seller_earnings?: number;
          seller_id?: string;
          status?: string;
          tax_amount?: number;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "orders_coupon_id_fkey";
            columns: ["coupon_id"];
            isOneToOne: false;
            referencedRelation: "coupons";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_events: {
        Row: {
          created_at: string;
          event_type: string;
          id: string;
          payload: Json;
          provider: string;
          provider_event_id: string;
        };
        Insert: {
          created_at?: string;
          event_type: string;
          id?: string;
          payload: Json;
          provider: string;
          provider_event_id: string;
        };
        Update: {
          created_at?: string;
          event_type?: string;
          id?: string;
          payload?: Json;
          provider?: string;
          provider_event_id?: string;
        };
        Relationships: [];
      };
      payout_methods: {
        Row: {
          account_holder_name: string | null;
          bank_account_number: string | null;
          bank_ifsc: string | null;
          bank_name: string | null;
          created_at: string;
          id: string;
          method_type: string;
          provider_contact_id: string | null;
          provider_fund_account_id: string | null;
          upi_number: string | null;
          user_id: string;
        };
        Insert: {
          account_holder_name?: string | null;
          bank_account_number?: string | null;
          bank_ifsc?: string | null;
          bank_name?: string | null;
          created_at?: string;
          id?: string;
          method_type: string;
          provider_contact_id?: string | null;
          provider_fund_account_id?: string | null;
          upi_number?: string | null;
          user_id: string;
        };
        Update: {
          account_holder_name?: string | null;
          bank_account_number?: string | null;
          bank_ifsc?: string | null;
          bank_name?: string | null;
          created_at?: string;
          id?: string;
          method_type?: string;
          provider_contact_id?: string | null;
          provider_fund_account_id?: string | null;
          upi_number?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      payout_requests: {
        Row: {
          admin_note: string | null;
          amount: number;
          created_at: string;
          currency: string;
          id: string;
          method_id: string | null;
          processed_at: string | null;
          provider_reference: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          admin_note?: string | null;
          amount: number;
          created_at?: string;
          currency: string;
          id?: string;
          method_id?: string | null;
          processed_at?: string | null;
          provider_reference?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          admin_note?: string | null;
          amount?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          method_id?: string | null;
          processed_at?: string | null;
          provider_reference?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payout_requests_method_id_fkey";
            columns: ["method_id"];
            isOneToOne: false;
            referencedRelation: "payout_methods";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_settings: {
        Row: {
          key: string;
          updated_at: string;
          value: Json;
        };
        Insert: {
          key: string;
          updated_at?: string;
          value: Json;
        };
        Update: {
          key?: string;
          updated_at?: string;
          value?: Json;
        };
        Relationships: [];
      };
      product_questions: {
        Row: {
          answer: string | null;
          answered_at: string | null;
          answered_by: string | null;
          created_at: string;
          id: string;
          listing_id: string;
          question: string;
          user_id: string;
        };
        Insert: {
          answer?: string | null;
          answered_at?: string | null;
          answered_by?: string | null;
          created_at?: string;
          id?: string;
          listing_id: string;
          question: string;
          user_id: string;
        };
        Update: {
          answer?: string | null;
          answered_at?: string | null;
          answered_by?: string | null;
          created_at?: string;
          id?: string;
          listing_id?: string;
          question?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_questions_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      product_updates: {
        Row: {
          changelog: string;
          created_at: string;
          download_path: string | null;
          id: string;
          listing_id: string;
          title: string;
          version: string;
        };
        Insert: {
          changelog: string;
          created_at?: string;
          download_path?: string | null;
          id?: string;
          listing_id: string;
          title: string;
          version: string;
        };
        Update: {
          changelog?: string;
          created_at?: string;
          download_path?: string | null;
          id?: string;
          listing_id?: string;
          title?: string;
          version?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_updates_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      product_variants: {
        Row: {
          active: boolean;
          created_at: string;
          currency: string;
          description: string | null;
          id: string;
          listing_id: string;
          name: string;
          price: number;
          sort_order: number;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          currency?: string;
          description?: string | null;
          id?: string;
          listing_id: string;
          name: string;
          price: number;
          sort_order?: number;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          currency?: string;
          description?: string | null;
          id?: string;
          listing_id?: string;
          name?: string;
          price?: number;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "product_variants_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      profile_portfolio: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          image_url: string | null;
          sort_order: number;
          technologies: string[];
          title: string;
          updated_at: string;
          url: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          sort_order?: number;
          technologies?: string[];
          title: string;
          updated_at?: string;
          url?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          sort_order?: number;
          technologies?: string[];
          title?: string;
          updated_at?: string;
          url?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          availability: string | null;
          avatar_url: string | null;
          bio: string | null;
          cover_url: string | null;
          created_at: string;
          display_name: string | null;
          email: string | null;
          experience_level: string | null;
          github_url: string | null;
          headline: string | null;
          hourly_rate: number | null;
          id: string;
          languages: string[] | null;
          services: string[] | null;
          skills: string[] | null;
          twitter_url: string | null;
          username: string | null;
          website_url: string | null;
          years_experience: number | null;
        };
        Insert: {
          availability?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          cover_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          experience_level?: string | null;
          github_url?: string | null;
          headline?: string | null;
          hourly_rate?: number | null;
          id: string;
          languages?: string[] | null;
          services?: string[] | null;
          skills?: string[] | null;
          twitter_url?: string | null;
          username?: string | null;
          website_url?: string | null;
          years_experience?: number | null;
        };
        Update: {
          availability?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          cover_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          experience_level?: string | null;
          github_url?: string | null;
          headline?: string | null;
          hourly_rate?: number | null;
          id?: string;
          languages?: string[] | null;
          services?: string[] | null;
          skills?: string[] | null;
          twitter_url?: string | null;
          username?: string | null;
          website_url?: string | null;
          years_experience?: number | null;
        };
        Relationships: [];
      };
      project_deliveries: {
        Row: {
          approved_at: string | null;
          created_at: string;
          file_paths: string[];
          final_url: string | null;
          id: string;
          kind: string;
          notes: string | null;
          preview_url: string | null;
          request_id: string;
          status: string;
          submitted_by: string;
          version: number;
        };
        Insert: {
          approved_at?: string | null;
          created_at?: string;
          file_paths?: string[];
          final_url?: string | null;
          id?: string;
          kind: string;
          notes?: string | null;
          preview_url?: string | null;
          request_id: string;
          status?: string;
          submitted_by: string;
          version?: number;
        };
        Update: {
          approved_at?: string | null;
          created_at?: string;
          file_paths?: string[];
          final_url?: string | null;
          id?: string;
          kind?: string;
          notes?: string | null;
          preview_url?: string | null;
          request_id?: string;
          status?: string;
          submitted_by?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "project_deliveries_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "website_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      project_disputes: {
        Row: {
          admin_note: string | null;
          created_at: string;
          id: string;
          project_id: string;
          raised_by: string;
          reason: string;
          resolved_at: string | null;
          resolved_by: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          admin_note?: string | null;
          created_at?: string;
          id?: string;
          project_id: string;
          raised_by: string;
          reason: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          admin_note?: string | null;
          created_at?: string;
          id?: string;
          project_id?: string;
          raised_by?: string;
          reason?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_disputes_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "website_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      project_messages: {
        Row: {
          attachment_paths: string[];
          body: string;
          created_at: string;
          id: string;
          read_at: string | null;
          request_id: string;
          sender_id: string;
        };
        Insert: {
          attachment_paths?: string[];
          body?: string;
          created_at?: string;
          id?: string;
          read_at?: string | null;
          request_id: string;
          sender_id: string;
        };
        Update: {
          attachment_paths?: string[];
          body?: string;
          created_at?: string;
          id?: string;
          read_at?: string | null;
          request_id?: string;
          sender_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_messages_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "website_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      project_milestones: {
        Row: {
          completed_at: string | null;
          created_at: string;
          id: string;
          request_id: string;
          sort_order: number;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          request_id: string;
          sort_order?: number;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          request_id?: string;
          sort_order?: number;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_milestones_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "website_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      project_payments: {
        Row: {
          amount: number;
          created_at: string;
          currency: string;
          developer_amount: number;
          id: string;
          payee_id: string;
          payer_id: string;
          platform_fee: number;
          provider: string;
          provider_payment_intent: string | null;
          provider_session_id: string | null;
          request_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          currency?: string;
          developer_amount: number;
          id?: string;
          payee_id: string;
          payer_id: string;
          platform_fee: number;
          provider?: string;
          provider_payment_intent?: string | null;
          provider_session_id?: string | null;
          request_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          currency?: string;
          developer_amount?: number;
          id?: string;
          payee_id?: string;
          payer_id?: string;
          platform_fee?: number;
          provider?: string;
          provider_payment_intent?: string | null;
          provider_session_id?: string | null;
          request_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_payments_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "website_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      project_proposals: {
        Row: {
          created_at: string;
          currency: string;
          developer_id: string;
          estimated_days: number | null;
          id: string;
          message: string;
          portfolio_urls: string[];
          proposed_amount: number | null;
          request_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          currency?: string;
          developer_id: string;
          estimated_days?: number | null;
          id?: string;
          message: string;
          portfolio_urls?: string[];
          proposed_amount?: number | null;
          request_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          developer_id?: string;
          estimated_days?: number | null;
          id?: string;
          message?: string;
          portfolio_urls?: string[];
          proposed_amount?: number | null;
          request_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_proposals_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "website_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      project_revisions: {
        Row: {
          created_at: string;
          delivery_id: string;
          id: string;
          notes: string;
          request_id: string;
          requested_by: string;
        };
        Insert: {
          created_at?: string;
          delivery_id: string;
          id?: string;
          notes: string;
          request_id: string;
          requested_by: string;
        };
        Update: {
          created_at?: string;
          delivery_id?: string;
          id?: string;
          notes?: string;
          request_id?: string;
          requested_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_revisions_delivery_id_fkey";
            columns: ["delivery_id"];
            isOneToOne: false;
            referencedRelation: "project_deliveries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_revisions_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "website_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      public_profiles: {
        Row: {
          availability: string | null;
          avatar_url: string | null;
          bio: string | null;
          cover_url: string | null;
          created_at: string;
          display_name: string | null;
          experience_level: string | null;
          github_url: string | null;
          headline: string | null;
          hourly_rate: number | null;
          id: string;
          languages: string[] | null;
          services: string[] | null;
          skills: string[] | null;
          twitter_url: string | null;
          updated_at: string;
          username: string | null;
          verified: boolean;
          website_url: string | null;
          years_experience: number | null;
        };
        Insert: {
          availability?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          cover_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          experience_level?: string | null;
          github_url?: string | null;
          headline?: string | null;
          hourly_rate?: number | null;
          id: string;
          languages?: string[] | null;
          services?: string[] | null;
          skills?: string[] | null;
          twitter_url?: string | null;
          updated_at?: string;
          username?: string | null;
          verified?: boolean;
          website_url?: string | null;
          years_experience?: number | null;
        };
        Update: {
          availability?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          cover_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          experience_level?: string | null;
          github_url?: string | null;
          headline?: string | null;
          hourly_rate?: number | null;
          id?: string;
          languages?: string[] | null;
          services?: string[] | null;
          skills?: string[] | null;
          twitter_url?: string | null;
          updated_at?: string;
          username?: string | null;
          verified?: boolean;
          website_url?: string | null;
          years_experience?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "public_profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limit_buckets: {
        Row: {
          hits: number;
          key: string;
          updated_at: string;
          window_started_at: string;
        };
        Insert: {
          hits?: number;
          key: string;
          updated_at?: string;
          window_started_at?: string;
        };
        Update: {
          hits?: number;
          key?: string;
          updated_at?: string;
          window_started_at?: string;
        };
        Relationships: [];
      };
      referrals: {
        Row: {
          created_at: string;
          currency: string;
          id: string;
          referred_id: string;
          referrer_id: string;
          reward_amount: number;
          status: string;
        };
        Insert: {
          created_at?: string;
          currency?: string;
          id?: string;
          referred_id: string;
          referrer_id: string;
          reward_amount?: number;
          status?: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          id?: string;
          referred_id?: string;
          referrer_id?: string;
          reward_amount?: number;
          status?: string;
        };
        Relationships: [];
      };
      refund_requests: {
        Row: {
          admin_note: string | null;
          buyer_id: string;
          created_at: string;
          details: string | null;
          id: string;
          order_id: string;
          reason: string;
          resolved_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          admin_note?: string | null;
          buyer_id: string;
          created_at?: string;
          details?: string | null;
          id?: string;
          order_id: string;
          reason: string;
          resolved_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          admin_note?: string | null;
          buyer_id?: string;
          created_at?: string;
          details?: string | null;
          id?: string;
          order_id?: string;
          reason?: string;
          resolved_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "refund_requests_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      reports: {
        Row: {
          created_at: string;
          details: string | null;
          id: string;
          listing_id: string | null;
          message_id: string | null;
          reason: string;
          reported_user_id: string | null;
          reporter_id: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          details?: string | null;
          id?: string;
          listing_id?: string | null;
          message_id?: string | null;
          reason: string;
          reported_user_id?: string | null;
          reporter_id: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          details?: string | null;
          id?: string;
          listing_id?: string | null;
          message_id?: string | null;
          reason?: string;
          reported_user_id?: string | null;
          reporter_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reports_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
        ];
      };
      review_helpful: {
        Row: {
          created_at: string;
          id: string;
          review_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          review_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          review_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_helpful_review_id_fkey";
            columns: ["review_id"];
            isOneToOne: false;
            referencedRelation: "reviews";
            referencedColumns: ["id"];
          },
        ];
      };
      reviews: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          images: string[];
          listing_id: string;
          rating: number;
          seller_replied_at: string | null;
          seller_reply: string | null;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          images?: string[];
          listing_id: string;
          rating: number;
          seller_replied_at?: string | null;
          seller_reply?: string | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          images?: string[];
          listing_id?: string;
          rating?: number;
          seller_replied_at?: string | null;
          seller_reply?: string | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reviews_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_user_public_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "public_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_developers: {
        Row: {
          created_at: string;
          developer_id: string;
          id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          developer_id: string;
          id?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          developer_id?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      search_query_stats: {
        Row: {
          display_query: string;
          last_searched_at: string;
          normalized_query: string;
          search_count: number;
        };
        Insert: {
          display_query: string;
          last_searched_at?: string;
          normalized_query: string;
          search_count?: number;
        };
        Update: {
          display_query?: string;
          last_searched_at?: string;
          normalized_query?: string;
          search_count?: number;
        };
        Relationships: [];
      };
      seller_payment_accounts: {
        Row: {
          charges_enabled: boolean;
          country_code: string | null;
          created_at: string;
          details_submitted: boolean;
          id: string;
          onboarding_status: string;
          payouts_enabled: boolean;
          provider: string;
          provider_account_id: string;
          requirements: Json;
          seller_id: string;
          updated_at: string;
        };
        Insert: {
          charges_enabled?: boolean;
          country_code?: string | null;
          created_at?: string;
          details_submitted?: boolean;
          id?: string;
          onboarding_status?: string;
          payouts_enabled?: boolean;
          provider: string;
          provider_account_id: string;
          requirements?: Json;
          seller_id: string;
          updated_at?: string;
        };
        Update: {
          charges_enabled?: boolean;
          country_code?: string | null;
          created_at?: string;
          details_submitted?: boolean;
          id?: string;
          onboarding_status?: string;
          payouts_enabled?: boolean;
          provider?: string;
          provider_account_id?: string;
          requirements?: Json;
          seller_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      seller_verification_documents: {
        Row: {
          created_at: string;
          document_type: string;
          file_name: string;
          id: string;
          status: string;
          storage_path: string;
          verification_id: string;
        };
        Insert: {
          created_at?: string;
          document_type: string;
          file_name: string;
          id?: string;
          status?: string;
          storage_path: string;
          verification_id: string;
        };
        Update: {
          created_at?: string;
          document_type?: string;
          file_name?: string;
          id?: string;
          status?: string;
          storage_path?: string;
          verification_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "seller_verification_documents_verification_id_fkey";
            columns: ["verification_id"];
            isOneToOne: false;
            referencedRelation: "seller_verifications";
            referencedColumns: ["id"];
          },
        ];
      };
      seller_verifications: {
        Row: {
          country_code: string | null;
          created_at: string;
          id: string;
          legal_name: string | null;
          notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          tax_id: string | null;
          updated_at: string;
          user_id: string;
          website: string | null;
        };
        Insert: {
          country_code?: string | null;
          created_at?: string;
          id?: string;
          legal_name?: string | null;
          notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          tax_id?: string | null;
          updated_at?: string;
          user_id: string;
          website?: string | null;
        };
        Update: {
          country_code?: string | null;
          created_at?: string;
          id?: string;
          legal_name?: string | null;
          notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          tax_id?: string | null;
          updated_at?: string;
          user_id?: string;
          website?: string | null;
        };
        Relationships: [];
      };
      storefront_settings: {
        Row: {
          accent: string | null;
          banner_url: string | null;
          bio: string | null;
          featured_listing_ids: string[];
          is_public: boolean;
          logo_url: string | null;
          social_links: Json;
          store_name: string | null;
          tagline: string | null;
          updated_at: string;
          user_id: string;
          website_url: string | null;
        };
        Insert: {
          accent?: string | null;
          banner_url?: string | null;
          bio?: string | null;
          featured_listing_ids?: string[];
          is_public?: boolean;
          logo_url?: string | null;
          social_links?: Json;
          store_name?: string | null;
          tagline?: string | null;
          updated_at?: string;
          user_id: string;
          website_url?: string | null;
        };
        Update: {
          accent?: string | null;
          banner_url?: string | null;
          bio?: string | null;
          featured_listing_ids?: string[];
          is_public?: boolean;
          logo_url?: string | null;
          social_links?: Json;
          store_name?: string | null;
          tagline?: string | null;
          updated_at?: string;
          user_id?: string;
          website_url?: string | null;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          amount: number;
          cancel_at: string | null;
          cancel_at_period_end: boolean;
          created_at: string;
          currency: string;
          current_period_end: string | null;
          id: string;
          interval: string;
          latest_invoice_id: string | null;
          listing_id: string;
          provider: string | null;
          provider_customer_id: string | null;
          provider_price_id: string | null;
          provider_subscription_id: string | null;
          status: string;
          user_id: string;
          variant_id: string | null;
        };
        Insert: {
          amount?: number;
          cancel_at?: string | null;
          cancel_at_period_end?: boolean;
          created_at?: string;
          currency?: string;
          current_period_end?: string | null;
          id?: string;
          interval?: string;
          latest_invoice_id?: string | null;
          listing_id: string;
          provider?: string | null;
          provider_customer_id?: string | null;
          provider_price_id?: string | null;
          provider_subscription_id?: string | null;
          status?: string;
          user_id: string;
          variant_id?: string | null;
        };
        Update: {
          amount?: number;
          cancel_at?: string | null;
          cancel_at_period_end?: boolean;
          created_at?: string;
          currency?: string;
          current_period_end?: string | null;
          id?: string;
          interval?: string;
          latest_invoice_id?: string | null;
          listing_id?: string;
          provider?: string | null;
          provider_customer_id?: string | null;
          provider_price_id?: string | null;
          provider_subscription_id?: string | null;
          status?: string;
          user_id?: string;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      support_messages: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          sender_id: string;
          ticket_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          sender_id: string;
          ticket_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          sender_id?: string;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_messages_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "support_tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      support_tickets: {
        Row: {
          assigned_to: string | null;
          category: string;
          created_at: string;
          id: string;
          order_id: string | null;
          priority: string;
          status: string;
          subject: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          assigned_to?: string | null;
          category?: string;
          created_at?: string;
          id?: string;
          order_id?: string | null;
          priority?: string;
          status?: string;
          subject: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          assigned_to?: string | null;
          category?: string;
          created_at?: string;
          id?: string;
          order_id?: string | null;
          priority?: string;
          status?: string;
          subject?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_tickets_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      tax_profiles: {
        Row: {
          business_name: string | null;
          business_type: string | null;
          country_code: string | null;
          region_code: string | null;
          tax_number: string | null;
          updated_at: string;
          user_id: string;
          verified: boolean;
        };
        Insert: {
          business_name?: string | null;
          business_type?: string | null;
          country_code?: string | null;
          region_code?: string | null;
          tax_number?: string | null;
          updated_at?: string;
          user_id: string;
          verified?: boolean;
        };
        Update: {
          business_name?: string | null;
          business_type?: string | null;
          country_code?: string | null;
          region_code?: string | null;
          tax_number?: string | null;
          updated_at?: string;
          user_id?: string;
          verified?: boolean;
        };
        Relationships: [];
      };
      user_blocks: {
        Row: {
          blocked_id: string;
          blocker_id: string;
          created_at: string;
        };
        Insert: {
          blocked_id: string;
          blocker_id: string;
          created_at?: string;
        };
        Update: {
          blocked_id?: string;
          blocker_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      webhook_deliveries: {
        Row: {
          attempts: number;
          error_message: string | null;
          event_id: string;
          event_type: string | null;
          id: string;
          payload: Json | null;
          processed_at: string | null;
          provider: string;
          received_at: string;
          status: string;
        };
        Insert: {
          attempts?: number;
          error_message?: string | null;
          event_id: string;
          event_type?: string | null;
          id?: string;
          payload?: Json | null;
          processed_at?: string | null;
          provider: string;
          received_at?: string;
          status?: string;
        };
        Update: {
          attempts?: number;
          error_message?: string | null;
          event_id?: string;
          event_type?: string | null;
          id?: string;
          payload?: Json | null;
          processed_at?: string | null;
          provider?: string;
          received_at?: string;
          status?: string;
        };
        Relationships: [];
      };
      website_requests: {
        Row: {
          agreed_amount: number | null;
          agreed_currency: string | null;
          budget: number;
          category: string | null;
          contact: string | null;
          created_at: string;
          currency: string;
          deadline: string | null;
          description: string;
          design_references: string | null;
          domain_needs: string | null;
          hosting_needs: string | null;
          id: string;
          is_draft: boolean;
          package_type: string | null;
          photos: string[];
          preferred_technologies: string[] | null;
          project_status: string | null;
          purpose: string | null;
          reference_urls: string[] | null;
          requester_id: string;
          required_functionality: string | null;
          required_pages: string | null;
          revision_limit: number;
          revisions_used: number;
          selected_proposal_id: string | null;
          status: string;
          taken_at: string | null;
          taken_by: string | null;
          target_audience: string | null;
          tier: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          agreed_amount?: number | null;
          agreed_currency?: string | null;
          budget: number;
          category?: string | null;
          contact?: string | null;
          created_at?: string;
          currency?: string;
          deadline?: string | null;
          description: string;
          design_references?: string | null;
          domain_needs?: string | null;
          hosting_needs?: string | null;
          id?: string;
          is_draft?: boolean;
          package_type?: string | null;
          photos?: string[];
          preferred_technologies?: string[] | null;
          project_status?: string | null;
          purpose?: string | null;
          reference_urls?: string[] | null;
          requester_id: string;
          required_functionality?: string | null;
          required_pages?: string | null;
          revision_limit?: number;
          revisions_used?: number;
          selected_proposal_id?: string | null;
          status?: string;
          taken_at?: string | null;
          taken_by?: string | null;
          target_audience?: string | null;
          tier?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          agreed_amount?: number | null;
          agreed_currency?: string | null;
          budget?: number;
          category?: string | null;
          contact?: string | null;
          created_at?: string;
          currency?: string;
          deadline?: string | null;
          description?: string;
          design_references?: string | null;
          domain_needs?: string | null;
          hosting_needs?: string | null;
          id?: string;
          is_draft?: boolean;
          package_type?: string | null;
          photos?: string[];
          preferred_technologies?: string[] | null;
          project_status?: string | null;
          purpose?: string | null;
          reference_urls?: string[] | null;
          requester_id?: string;
          required_functionality?: string | null;
          required_pages?: string | null;
          revision_limit?: number;
          revisions_used?: number;
          selected_proposal_id?: string | null;
          status?: string;
          taken_at?: string | null;
          taken_by?: string | null;
          target_audience?: string | null;
          tier?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "website_requests_selected_proposal_fkey";
            columns: ["selected_proposal_id"];
            isOneToOne: false;
            referencedRelation: "project_proposals";
            referencedColumns: ["id"];
          },
        ];
      };
      wishlists: {
        Row: {
          created_at: string;
          id: string;
          listing_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          listing_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          listing_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wishlists_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      creator_stats: {
        Row: {
          creator_id: string | null;
          followers: number | null;
          products: number | null;
          rating_avg: number | null;
          sales: number | null;
        };
        Relationships: [];
      };
      listing_stats: {
        Row: {
          listing_id: string | null;
          rating_avg: number | null;
          rating_count: number | null;
          sales_count: number | null;
        };
        Relationships: [];
      };
      website_requests_public: {
        Row: {
          agreed_amount: number | null;
          agreed_currency: string | null;
          budget: number | null;
          category: string | null;
          created_at: string | null;
          currency: string | null;
          deadline: string | null;
          description: string | null;
          design_references: string | null;
          domain_needs: string | null;
          hosting_needs: string | null;
          id: string | null;
          is_draft: boolean | null;
          package_type: string | null;
          photos: string[] | null;
          preferred_technologies: string[] | null;
          project_status: string | null;
          purpose: string | null;
          reference_urls: string[] | null;
          requester_id: string | null;
          required_functionality: string | null;
          required_pages: string | null;
          selected_proposal_id: string | null;
          status: string | null;
          taken_at: string | null;
          taken_by: string | null;
          target_audience: string | null;
          tier: string | null;
          title: string | null;
          updated_at: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      claim_website_request: {
        Args: {
          claimer_id: string;
          request_id: string;
        };
        Returns: boolean;
      };
      complete_website_request: {
        Args: {
          actor_id: string;
          request_id: string;
        };
        Returns: boolean;
      };
      consume_coupon: {
        Args: {
          p_amount: number;
          p_buyer_id: string;
          p_coupon_id: string;
          p_order_id: string;
        };
        Returns: unknown;
      };
      consume_rate_limit: {
        Args: {
          p_key: string;
          p_limit: number;
          p_window_seconds: number;
        };
        Returns: boolean;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      queue_listing_scans: {
        Args: {
          p_listing_id: string;
        };
        Returns: number;
      };
      admin_override_scan: {
        Args: {
          p_note?: string;
          p_scan_id: string;
        };
        Returns: string;
      };
      admin_rescan_listing: {
        Args: {
          p_listing_id: string;
        };
        Returns: number;
      };
      record_search_query: {
        Args: {
          p_query: string;
        };
        Returns: unknown;
      };
      redeem_gift_card: {
        Args: {
          p_amount: number;
          p_code: string;
          p_currency: string;
          p_order_id: string;
          p_user_id: string;
        };
        Returns: number;
      };
      search_listing_ids: {
        Args: {
          p_limit: number;
          p_query: string;
        };
        Returns: { listing_id: string }[];
      };
      search_suggestions: {
        Args: {
          p_limit: number;
          p_query: string;
        };
        Returns: {
          category: string | null;
          currency: string | null;
          label: string;
          listing_id: string | null;
          popularity: number;
          price: number | null;
          suggestion_type: string;
        }[];
      };
      select_project_proposal: {
        Args: {
          p_proposal_id: string;
          p_request_id: string;
        };
        Returns: boolean;
      };
      transition_project_status: {
        Args: {
          p_request_id: string;
          p_status: string;
        };
        Returns: boolean;
      };
      validate_coupon: {
        Args: {
          p_amount: number;
          p_buyer_id: string;
          p_code: string;
          p_currency: string;
          p_seller_id?: string;
        };
        Returns: {
          coupon_id: string;
          discount_amount: number;
          discount_type: string;
          discount_value: number;
        }[];
      };
      write_admin_audit: {
        Args: {
          p_action: string;
          p_admin_id: string;
          p_metadata: Json;
          p_target_id: string | null;
          p_target_type: string;
        };
        Returns: unknown;
      };
    };
    Enums: {
      app_role: "admin" | "moderator" | "user";
      listing_kind: "software" | "website";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      listing_kind: ["software", "website"],
    },
  },
} as const;
