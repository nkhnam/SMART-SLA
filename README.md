# Shadow-Byte

## Local architecture

- Frontend: Next.js at `http://localhost:3000` (or the next available port, such as `3001`).
- Backend: NestJS API at `http://localhost:3002`.
- Database: PostgreSQL at `localhost:5432` from `docker-compose.yml`.

Copy `backend/.env.example` to `backend/.env`, start PostgreSQL, then run `npm run start:dev` in both `backend` and `frontend`. If the API is unavailable, the UI keeps the contract workflow usable with browser-local showcase data and clearly routes newly created contracts to **Đã gửi**.

