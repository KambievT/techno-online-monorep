# Techno backend

## Run

```bash
pnpm --filter @techno/backend start
```

## API

- `POST /auth/admin/login` — admin login, returns bearer token
- `GET /products` — public products list (`categoryId`, `filterId`, `q` query params)
- `GET /categories` — public categories list
- `GET /admin/products` + CRUD (`POST/PUT/DELETE` require token)
- `GET /admin/categories` + CRUD (`POST/PUT/DELETE` require token)
- `GET /admin/filters` + CRUD (`POST/PUT/DELETE` require token)
- `GET /admin/store-addresses` + CRUD (`POST/PUT/DELETE` require token)
- `POST /admin/minio/upload-base64` — store file metadata for MinIO upload flow
- `GET /health` — service health + MinIO configuration

## Env

Copy `.env.example` to `.env` and adjust values.
