import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index';
import { createTestUser } from './setup';

const app = createApp();

describe('Auth API', () => {
  it('registers a new patient account', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'new.patient@test.com',
      password: 'SecurePass123',
      name: 'New Patient',
      role: 'patient',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.token).toBeTypeOf('string');
    expect(res.body.data.user).toMatchObject({ email: 'new.patient@test.com', role: 'patient' });
    expect(res.body.data.user).not.toHaveProperty('password_hash');
  });

  it('logs in with valid credentials', async () => {
    const doctor = createTestUser('doctor', { email: 'doc@test.com', password: 'Doctor123!' });

    const res = await request(app).post('/api/auth/login').send({ email: 'doc@test.com', password: 'Doctor123!' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTypeOf('string');
    expect(res.body.data.user.id).toBe(doctor.id);
  });

  it('returns the current user for a valid token', async () => {
    const admin = createTestUser('admin');

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: admin.id, role: 'admin' });
  });
});
