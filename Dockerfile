# NORDEVA Marketplace — production image (Node 22, see .nvmrc)
FROM node:22-slim

WORKDIR /app

# VITE_* variables are baked into the client bundle at build time, so the
# public Supabase values must be present during `docker build`:
#   docker build --build-arg VITE_SUPABASE_URL=... \
#                --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=... \
#                --build-arg VITE_APP_URL=https://your-domain -t nordeva .
# Server secrets (SUPABASE_SERVICE_ROLE_KEY, payment keys, ...) are NOT
# build args — pass them at run time with `docker run -e ...` or your
# orchestrator's secret store. Never bake them into the image.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_APP_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_APP_URL=$VITE_APP_URL

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "3000"]
