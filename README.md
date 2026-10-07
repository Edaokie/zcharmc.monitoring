# ZCharMC Monitoring

CO₂ adsorption monitoring prototype with three independently released components:

| Directory | Responsibility | Deployment |
| --- | --- | --- |
| `frontend/` | React/TypeScript dashboard | Vercel |
| `backend/` | Django API, admin, Socket.IO, PostgreSQL | Railway |
| `firmware/` | ESP32 sensors and equipment control | PlatformIO/device flashing |

Start with [backend setup and deployment](backend/README.md). The backend preserves
the dashboard's existing read APIs and live event protocol. Firmware is unchanged
and currently targets a private MQTT broker; cloud deployment alone does not connect
physical devices. Free hosting plans are for development here and do not provide
an industrial 24/7 availability guarantee.

GitHub Actions validates every push and pull request. Vercel and Railway deploy via
their native Git integrations after the one-time account setup described in the guide.
No database credentials or hosting tokens belong in Git.
