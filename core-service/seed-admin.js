const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const password_hash = await bcrypt.hash('admin123', 10);
  const user = await prisma.user.upsert({
    where: { email: 'admin@test.com' },
    update: {},
    create: {
      email: 'admin@test.com',
      username: 'admin',
      name: 'System Admin',
      role: 'ADMIN',
      password_hash,
    },
  });
  console.log('Admin user seeded:', user.email);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
