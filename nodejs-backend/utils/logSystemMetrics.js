const os = require('node:os');
const fs = require('fs');

function logSystemMetrics() {
  // Get CPU metrics
  const cpus = os.cpus();
  const cpuEntries = cpus.map((cpu, index) => {
    const { times } = cpu;
    const total = times.user + times.nice + times.sys + times.idle + times.irq;
    const usage = 100 - Math.round((100 * times.idle) / total);
    return `CPU ${index}: ${usage}% (User: ${times.user}, Nice: ${times.nice}, Sys: ${times.sys}, Idle: ${times.idle}, IRQ: ${times.irq})`;
  }).join(', ');

  // Get memory metrics
  const memoryUsage = process.memoryUsage();
  const memoryEntries = `Heap Total: ${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB, Heap Used: ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB, External: ${(memoryUsage.external / 1024 / 1024).toFixed(2)} MB, RSS: ${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`;

  // Get network metrics
  const networkInterfaces = os.networkInterfaces();
  const networkEntries = Object.entries(networkInterfaces).map(([name, interfaces]) => {
    const addresses = interfaces.map(iface => `${iface.family}: ${iface.address}`).join(', ');
    return `${name}: ${addresses}`;
  }).join(', ');

  // Format the log message
  const logMessage = `${new Date().toISOString()} - CPU: [${cpuEntries}], Memory: [${memoryEntries}], Network: [${networkEntries}]\n`;

  // Write the log message to a file
  fs.appendFile('system_metrics.log', logMessage, (err) => {
    if (err) {
      console.error('Error writing to log file', err);
    }
  });
}

module.exports = logSystemMetrics;
