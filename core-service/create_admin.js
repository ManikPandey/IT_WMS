const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('admin', 10);
  await prisma.user.create({
    data: {
      username: 'admin',
      name: 'Admin User',
      email: 'admin@example.com',
      password_hash: hash,
      role: 'ADMIN'
    }
  });
  console.log('Created admin user: admin / admin');
}

main().catch(console.error).finally(() => prisma.$disconnect());
