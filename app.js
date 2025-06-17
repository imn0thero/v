const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store waiting users and active rooms
let waitingUsers = [];
let activeRooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle user joining the queue
    socket.on('join-queue', (userData) => {
        console.log('User joined queue:', socket.id);
        
        // Add user to waiting list
        waitingUsers.push({
            id: socket.id,
            socket: socket,
            userData: userData
        });

        // Try to match with another user
        matchUsers();
    });

    // Handle WebRTC signaling
    socket.on('offer', (data) => {
        socket.to(data.to).emit('offer', {
            from: socket.id,
            offer: data.offer
        });
    });

    socket.on('answer', (data) => {
        socket.to(data.to).emit('answer', {
            from: socket.id,
            answer: data.answer
        });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.to).emit('ice-candidate', {
            from: socket.id,
            candidate: data.candidate
        });
    });

    // Handle chat messages
    socket.on('chat-message', (data) => {
        socket.to(data.to).emit('chat-message', {
            from: socket.id,
            message: data.message,
            timestamp: new Date().toISOString()
        });
    });

    // Handle next partner request
    socket.on('next-partner', () => {
        handleDisconnection(socket);
        
        // Add back to queue for new match
        waitingUsers.push({
            id: socket.id,
            socket: socket
        });
        
        matchUsers();
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        handleDisconnection(socket);
    });

    // Handle manual disconnect from chat
    socket.on('leave-chat', () => {
        handleDisconnection(socket);
    });
});

function matchUsers() {
    while (waitingUsers.length >= 2) {
        const user1 = waitingUsers.shift();
        const user2 = waitingUsers.shift();
        
        if (!user1.socket.connected || !user2.socket.connected) {
            // If one user disconnected, put the other back in queue
            if (user1.socket.connected) waitingUsers.unshift(user1);
            if (user2.socket.connected) waitingUsers.unshift(user2);
            continue;
        }

        const roomId = `room_${user1.id}_${user2.id}`;
        
        // Join both users to the room
        user1.socket.join(roomId);
        user2.socket.join(roomId);
        
        // Store active room
        activeRooms.set(user1.id, { roomId, partner: user2.id });
        activeRooms.set(user2.id, { roomId, partner: user1.id });
        
        // Notify both users they are matched
        user1.socket.emit('matched', { 
            partner: user2.id,
            roomId: roomId,
            isInitiator: true
        });
        
        user2.socket.emit('matched', { 
            partner: user1.id,
            roomId: roomId,
            isInitiator: false
        });
        
        console.log(`Matched users: ${user1.id} and ${user2.id} in room ${roomId}`);
    }
}

function handleDisconnection(socket) {
    // Remove from waiting queue
    waitingUsers = waitingUsers.filter(user => user.id !== socket.id);
    
    // Handle active room disconnection
    const roomInfo = activeRooms.get(socket.id);
    if (roomInfo) {
        const { roomId, partner } = roomInfo;
        
        // Notify partner about disconnection
        socket.to(partner).emit('partner-disconnected');
        
        // Clean up room
        socket.leave(roomId);
        activeRooms.delete(socket.id);
        activeRooms.delete(partner);
        
        console.log(`Room ${roomId} closed due to disconnection`);
    }
}

// API endpoint to get server stats
app.get('/api/stats', (req, res) => {
    res.json({
        waitingUsers: waitingUsers.length,
        activeRooms: activeRooms.size / 2, // Divided by 2 because each room has 2 entries
        totalConnections: io.engine.clientsCount
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to access the application`);
});
