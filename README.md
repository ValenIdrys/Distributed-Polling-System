
# Distributed Polling System

A distributed real-time polling system developed using Node.js, WebSocket and Redis. The application supports lecturer-managed polls, student voting, live result updates, multi-server synchronization and automatic client reconnection.

## Technologies Used

- Node.js
- Express.js
- WebSocket (`ws`)
- Redis
- HTML
- CSS
- JavaScript
- Docker

## System Architecture

The application consists of two Node.js server instances connected to a shared Redis database.

| Component | Port |
|---|---|
| Server 1 | 3000 |
| Server 2 | 3001 |
| Redis | 6379 |

## Prerequisites

Before running the application, install:

1. Node.js and npm
2. Docker Desktop
3. Git (optional, for cloning the repository)

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/ValenIdrys/Distributed-Polling-System.git
   ```

2. Navigate into the project directory:

   ```bash
   cd Distributed-Polling-System
   ```

3. Install the project dependencies:

   ```bash
   npm install
   ```

## Running the Application

### 1. Start Redis

Start the Redis Docker container:

```bash
docker start redis
```

If the Redis container does not exist yet, create it first:

```bash
docker run -d --name redis -p 6379:6379 redis
```

### 2. Start Server 1

Open a terminal in the project directory and execute:

```bash
node server1.js
```

Server 1 runs on port 3000.

### 3. Start Server 2

Open another terminal in the same project directory and execute:

```bash
node server2.js
```

Server 2 runs on port 3001.

### 4. Access the Application

Open either address in your web browser:

- http://localhost:3000
- http://localhost:3001

Users can connect to either server to participate in the polling session.

## Main Source Files

| File | Description |
|---|---|
| `server1.js` | First Node.js application server. |
| `server2.js` | Second Node.js application server. |
| `redis-store.js` | Redis connection, data storage, atomic operations and Pub/Sub functionality. |
| `public/index.html` | Web application interface structure. |
| `public/app.js` | Client-side functionality and WebSocket communication. |
| `public/style.css` | Application styling. |

## Testing Files

The repository also includes Redis testing scripts for checking Redis connectivity, voting operations, poll management and user-session functionality.

## Features

- Lecturer and student login
- Poll creation and management
- Real-time student voting
- Live voting results
- Duplicate vote prevention
- Multi-server synchronization
- Redis shared data storage
- Automatic server failover and session recovery

## GitHub Repository

https://github.com/ValenIdrys/Distributed-Polling-System
