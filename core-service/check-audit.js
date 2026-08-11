const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const logs = await prisma.auditLog.findMany();
  console.log('Audit Logs in Core DB:');
  console.log(logs);
}

check();
