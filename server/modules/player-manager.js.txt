// Hallinnoi pelaajien yhteyksien katkaisuja ja poistumisia
function handleDisconnect(io, socket) {
  console.log('Client disconnected:', socket.id);
  
  const tableManager = require('./table-manager');
  const table = tableManager.findTableBySocketId(socket.id);
  
  if (table) {
    tableManager.leaveTable(io, socket);
  }
}

module.exports = {
  handleDisconnect
};