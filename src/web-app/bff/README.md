# Polymarket BFF (Backend for Frontend)

A clean, scalable Express.js + TypeScript backend service for the Polymarket web application.

## Project Structure

```
src/
├── index.ts                 # Main server entry point
├── config/
│   └── index.ts            # Configuration management & environment variables
├── controllers/
│   └── example.controller.ts    # Request handlers (business logic)
├── services/
│   └── example.service.ts       # Business logic & data access
├── routes/
│   └── example.routes.ts        # API route definitions
└── middleware/
    └── errorHandler.ts      # Error handling & 404 middleware
```

## Getting Started

### Prerequisites

- Node.js 16+ 
- npm or yarn

### Installation

```bash
npm install
```

### Environment Setup

Copy `.env.example` to `.env` and configure your settings:

```bash
cp .env.example .env
```

### Development

Start the development server with hot reload:

```bash
npm run dev
```

The server will start on the configured port (default: 5000).

### Ollama (Docker Compose)

To run Ollama locally via the project Docker stack:

```bash
docker compose up -d ollama ollama-pull
```

Then keep these values in `.env`:

```bash
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
```

### Build

Compile TypeScript to JavaScript:

```bash
npm run build
```

### Production

Build and start the production server:

```bash
npm run build
npm start
```

## API Endpoints

### Health Check
- `GET /health` - Server health status

### Markets
- `GET /api/markets/:marketId` - Get market data by ID
- `GET /api/markets/:marketId/conviction-history?limit=10` - Get conviction event history
- `GET /api/markets/search?keyword=bitcoin` - Search markets by keyword

## Configuration

Environment variables are managed in `src/config/index.ts`:

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | development | Environment mode |
| `PORT` | 5000 | Server port |
| `LOG_LEVEL` | info | Logging level |
| `COUCHBASE_CONNECTION_STRING` | couchbase://couchbase | Couchbase connection |
| `COUCHBASE_USERNAME` | Administrator | Couchbase user |
| `COUCHBASE_PASSWORD` | password | Couchbase password |
| `COUCHBASE_BUCKET` | polymarket | Couchbase bucket name |
| `MONGODB_URI` | mongodb://mongo:27017 | MongoDB connection |
| `MONGODB_DB` | polymarket | MongoDB database |
| `API_TIMEOUT` | 30000 | API timeout in ms |

## Code Organization

### Controllers
Handle HTTP requests and responses. Call services to perform business logic.

**Example**: `controllers/example.controller.ts`

### Services
Implement business logic and data access patterns. Independent of HTTP concerns.

**Example**: `services/example.service.ts`

### Routes
Define API endpoints and map them to controller methods.

**Example**: `routes/example.routes.ts`

### Middleware
Handle cross-cutting concerns (errors, logging, CORS, security).

**Example**: `middleware/errorHandler.ts`

## Error Handling

Errors are caught and standardized through the error handler middleware:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Error description",
    "status": 400
  }
}
```

## Next Steps

1. **Add Database Integration**: Connect Couchbase and MongoDB clients
2. **Implement Real Services**: Replace mock data with actual Couchbase queries
3. **Add Authentication**: Implement JWT or API key authentication
4. **Add Tests**: Add unit and integration tests
5. **Add Logging**: Integrate structured logging (winston, pino)
6. **Add Validation**: Add request validation middleware (joi, zod)
