import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index';
import { createTestPatientRecord, createTestUser } from './setup';

const app = createApp();

describe('Patients API', () => {
  it('admin can create a patient', async () => {
    const admin = createTestUser('admin');
    const doctor = createTestUser('doctor');

    const res = await request(app)
      .post('/api/patients')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        name: 'Jane Doe',
        email: 'jane.doe@test.com',
        password: 'Patient123!',
        date_of_birth: '1990-06-15',
        gender: 'female',
        blood_type: 'A+',
        allergies: ['Latex'],
        assigned_doctor_id: doctor.id,
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Jane Doe',
      blood_type: 'A+',
      allergies: ['Latex'],
      assigned_doctor_id: doctor.id,
    });
  });

  it('admin can list all patients', async () => {
    const admin = createTestUser('admin');
    const doctor = createTestUser('doctor');
    createTestPatientRecord(createTestUser('patient').id, doctor.id);
    createTestPatientRecord(createTestUser('patient').id, doctor.id);

    const res = await request(app).get('/api/patients').set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('doctor sees only their assigned patients in the list', async () => {
    const doctorA = createTestUser('doctor');
    const doctorB = createTestUser('doctor');
    createTestPatientRecord(createTestUser('patient').id, doctorA.id);
    createTestPatientRecord(createTestUser('patient').id, doctorB.id);

    const res = await request(app).get('/api/patients').set('Authorization', `Bearer ${doctorA.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].assigned_doctor_id).toBe(doctorA.id);
  });

  it('assigned doctor can view patient detail', async () => {
    const doctor = createTestUser('doctor');
    const patientId = createTestPatientRecord(createTestUser('patient').id, doctor.id);

    const res = await request(app).get(`/api/patients/${patientId}`).set('Authorization', `Bearer ${doctor.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(patientId);
    expect(res.body.data.allergies).toEqual(['Penicillin']);
  });

  it('assigned doctor can update a patient', async () => {
    const doctor = createTestUser('doctor');
    const patientId = createTestPatientRecord(createTestUser('patient').id, doctor.id);

    const res = await request(app)
      .put(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({ blood_type: 'B-', emergency_contact: 'John Doe' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ blood_type: 'B-', emergency_contact: 'John Doe' });
  });
});
