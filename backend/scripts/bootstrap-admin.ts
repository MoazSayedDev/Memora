import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

const adminEmail = 'memora@memora.com';
const adminUsername = 'memora_admin';

async function bootstrapAdmin() {
  const databaseUrl = process.env.DATABASE_URL;
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be configured');
  }
  if (
    !initialPassword ||
    initialPassword.length < 8 ||
    initialPassword.length > 72
  ) {
    throw new Error('ADMIN_INITIAL_PASSWORD must contain 8 to 72 characters');
  }

  const databaseHost = new URL(databaseUrl).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(databaseHost)) {
    throw new Error('Admin bootstrap is restricted to a local database');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const existingUser = await prisma.user.findUnique({
      where: { email: adminEmail },
      select: { id: true },
    });
    if (existingUser) {
      console.info('Admin account already exists; no changes made.');
      return;
    }

    const existingUsername = await prisma.user.findUnique({
      where: { username: adminUsername },
      select: { id: true },
    });
    if (existingUsername) {
      throw new Error('The admin username is already in use');
    }

    const passwordHash = await bcrypt.hash(initialPassword, 12);
    await prisma.user.create({
      data: {
        email: adminEmail,
        username: adminUsername,
        name: 'Memora Admin',
        passwordHash,
        isEmailVerified: true,
      },
      select: { id: true },
    });
    console.info('Verified admin account created.');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

void bootstrapAdmin().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
