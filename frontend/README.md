# Agent Console (minimal)

Frontend minimal scaffold (Next.js). Pages:

- `/` - login (stores JWT in localStorage)
- `/agent` - agent panel: select campaign, READY, CALL NEXT, Hangup, Mute

Run:

```bash
cd frontend
npm install
npm run dev
```

The frontend expects the backend API to be reachable at `http://localhost:3001`.
