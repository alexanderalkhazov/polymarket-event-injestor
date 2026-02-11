# Polymarket Authentication System

This project implements a complete end-to-end authentication system for the Polymarket web application.

## Features

✅ **User Registration & Login** - Secure account creation and authentication  
✅ **JWT-based Authentication** - Stateless token-based auth  
✅ **MongoDB User Storage** - Persistent user data in MongoDB  
✅ **Password Hashing** - bcrypt for secure password storage  
✅ **Protected Routes** - Client and server-side route protection  
✅ **React Context** - Global authentication state management  
✅ **Auto Token Management** - Axios interceptors handle tokens automatically  

## Architecture

### Backend (BFF - Backend for Frontend)
- **Tech Stack**: Express.js, TypeScript, MongoDB, Mongoose
- **Auth**: JWT tokens, bcrypt password hashing
- **Port**: 5000

### Frontend (Web Client)
- **Tech Stack**: React, TypeScript, Vite, React Router
- **State Management**: React Context API
- **HTTP Client**: Axios with interceptors
- **Port**: 3000

## Getting Started

### Prerequisites
- Node.js 18+
- Docker and Docker Compose (for full stack)
- npm or yarn

### Development Setup

#### 1. Start MongoDB (if using Docker)
```bash
docker-compose up mongo -d
```

#### 2. Backend Setup
```bash
cd src/web-app/bff
npm install
cp .env.example .env
# Edit .env and set JWT_SECRET
npm run dev
```

Backend will start on http://localhost:5000

#### 3. Frontend Setup
```bash
cd src/web-app/web-client
npm install
npm run dev
```

Frontend will start on http://localhost:3000

### Using Docker Compose

To run the entire stack including auth services:

```bash
docker-compose up bff mongo -d
```

Then run the frontend:
```bash
cd src/web-app/web-client
npm run dev
```

## API Endpoints

### Authentication Endpoints

#### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "...",
      "email": "user@example.com",
      "name": "John Doe"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "...",
      "email": "user@example.com",
      "name": "John Doe"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### Get Current User (Protected)
```http
GET /api/auth/me
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "email": "user@example.com",
    "name": "John Doe",
    "createdAt": "2026-02-11T..."
  }
}
```

#### Logout (Protected)
```http
POST /api/auth/logout
Authorization: Bearer <token>
```

## Frontend Usage

### Register a New User

Navigate to `/register` and fill in the registration form:
- Name
- Email
- Password (min 6 characters)
- Confirm Password

### Login

Navigate to `/login` and enter your credentials:
- Email
- Password

### Protected Routes

Once logged in, you'll be redirected to `/dashboard`. The dashboard is a protected route that requires authentication.

If you try to access `/dashboard` without being logged in, you'll be redirected to `/login`.

### Logout

Click the "Logout" button in the dashboard to sign out. This will:
- Clear the auth token from localStorage
- Reset the auth context state
- Redirect to the login page

## Project Structure

```
src/web-app/
├── bff/                          # Backend API
│   ├── src/
│   │   ├── config/
│   │   │   └── index.ts          # App configuration
│   │   ├── controllers/
│   │   │   └── auth.controller.ts # Auth request handlers
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts # JWT verification
│   │   │   └── errorHandler.ts
│   │   ├── models/
│   │   │   └── user.model.ts     # User schema & model
│   │   ├── routes/
│   │   │   └── auth.routes.ts    # Auth routes
│   │   ├── services/
│   │   │   └── auth.service.ts   # Auth business logic
│   │   ├── db.ts                 # MongoDB connection
│   │   └── index.ts              # App entry point
│   ├── .env
│   ├── Dockerfile
│   └── package.json
│
└── web-client/                   # React Frontend
    ├── src/
    │   ├── components/
    │   │   ├── Login.tsx         # Login form
    │   │   ├── Register.tsx      # Registration form
    │   │   ├── Dashboard.tsx     # Protected dashboard
    │   │   ├── ProtectedRoute.tsx # Route guard
    │   │   ├── Auth.css
    │   │   └── Dashboard.css
    │   ├── context/
    │   │   └── AuthContext.tsx   # Auth state management
    │   ├── services/
    │   │   └── api.ts            # API client with interceptors
    │   ├── App.tsx               # Main app with routing
    │   └── main.tsx
    ├── .env
    └── package.json
```

## Security Features

1. **Password Hashing**: Passwords are hashed using bcrypt with salt rounds before storage
2. **JWT Tokens**: Stateless authentication using signed JSON Web Tokens
3. **Token Expiration**: Tokens expire after 7 days (configurable)
4. **Protected Routes**: Server-side middleware validates tokens on protected endpoints
5. **Auto Logout**: Frontend automatically logs out on 401 (unauthorized) responses
6. **CORS**: Configured CORS for secure cross-origin requests
7. **Helmet**: Security headers via helmet middleware

## Database Schema

### User Collection
```typescript
{
  _id: ObjectId,
  email: string,        // Unique, lowercase
  password: string,     // Bcrypt hashed
  name: string,
  createdAt: Date,
  updatedAt: Date
}
```

## Environment Variables

### Backend (.env)
```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=horizon
JWT_SECRET=your-super-secret-key-change-in-production
JWT_EXPIRES_IN=7d
```

### Frontend (.env)
```env
VITE_API_URL=http://localhost:5000
```

## Testing the Auth Flow

1. **Start the backend**: `cd src/web-app/bff && npm run dev`
2. **Start the frontend**: `cd src/web-app/web-client && npm run dev`
3. **Open browser**: Navigate to http://localhost:3000
4. **Register**: Create a new account at `/register`
5. **Auto-login**: You'll be automatically logged in and redirected to dashboard
6. **Logout**: Click logout button
7. **Login**: Sign back in at `/login`

## Troubleshooting

### Backend Issues

**MongoDB Connection Failed**
- Ensure MongoDB is running: `docker-compose up mongo -d`
- Check MONGODB_URI in .env file

**JWT Token Errors**
- Verify JWT_SECRET is set in backend .env
- Check token expiration settings

### Frontend Issues

**API Calls Failing**
- Verify VITE_API_URL in frontend .env
- Check that backend is running on port 5000
- Check browser console for CORS errors

**Not Redirecting After Login**
- Check browser console for errors
- Verify token is being stored in localStorage
- Check AuthContext is properly wrapped around routes

## Next Steps

- Add email verification
- Implement password reset
- Add OAuth providers (Google, GitHub)
- Add role-based access control (RBAC)
- Add refresh token rotation
- Add rate limiting for auth endpoints
- Add 2FA (Two-Factor Authentication)

## License

MIT
