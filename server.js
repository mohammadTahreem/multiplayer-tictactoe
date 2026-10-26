const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// ── Room & game state store ──────────────────────────────────
const rooms = {}; // roomCode → { players[], board[], turn, gameOver }

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms[code] ? makeCode() : code; // retry on collision
}

function freshBoard() {
  return Array(9).fill(null);
}

function checkWinner(board) {
  const lines = [
    [0,1,2],[3,4,5],[6,7,8], // rows
    [0,3,6],[1,4,7],[2,5,8], // cols
    [0,4,8],[2,4,6]          // diags
  ];
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { mark: board[a], line: [a,b,c] };
    }
  }
  return board.every(cell => cell !== null) ? { mark: "draw" } : null;
}

// ── Socket.IO events ────────────────────────────────────────
io.on("connection", (socket) => {
  let currentRoom = null;
  let playerIndex = null;

  // Create a new room
  socket.on("create", (playerName) => {
    const code = makeCode();
    rooms[code] = {
      players: [{ id: socket.id, name: playerName || "Player 1", mark: "X" }],
      board: freshBoard(),
      turn: 0,
      gameOver: false,
    };
    currentRoom = code;
    playerIndex = 0;
    socket.join(code);
    socket.emit("created", { code, mark: "X", index: 0 });
  });

  // Join an existing room
  socket.on("join", ({ code, playerName }) => {
    code = code.toUpperCase().trim();
    const room = rooms[code];
    if (!room) return socket.emit("err", "Room not found.");
    if (room.players.length >= 2) return socket.emit("err", "Room is full.");

    room.players.push({ id: socket.id, name: playerName || "Player 2", mark: "O" });
    currentRoom = code;
    playerIndex = 1;
    socket.join(code);
    socket.emit("joined", { code, mark: "O", index: 1 });

    // Tell both players the game is starting
    io.to(code).emit("start", {
      board: room.board,
      turn: room.turn,
      players: room.players.map(p => p.name),
    });
  });

  // Handle a move
  socket.on("move", (cellIndex) => {
    const room = rooms[currentRoom];
    if (!room || room.gameOver) return;
    if (room.turn !== playerIndex) return; // not your turn
    if (room.board[cellIndex] !== null) return; // cell taken

    room.board[cellIndex] = room.players[playerIndex].mark;
    const result = checkWinner(room.board);

    if (result) {
      room.gameOver = true;
      io.to(currentRoom).emit("gameOver", {
        board: room.board,
        result, // { mark, line? }
        players: room.players.map(p => p.name),
      });
    } else {
      room.turn = 1 - room.turn;
      io.to(currentRoom).emit("update", {
        board: room.board,
        turn: room.turn,
      });
    }
  });

  // Rematch
  socket.on("rematch", () => {
    const room = rooms[currentRoom];
    if (!room) return;
    room.board = freshBoard();
    room.turn = 0;
    room.gameOver = false;
    io.to(currentRoom).emit("start", {
      board: room.board,
      turn: room.turn,
      players: room.players.map(p => p.name),
    });
  });

  // Disconnect cleanup
  socket.on("disconnect", () => {
    if (currentRoom && rooms[currentRoom]) {
      io.to(currentRoom).emit("err", "Other player disconnected.");
      delete rooms[currentRoom];
    }
  });
});

// ── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
