const { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } = require('@asteasolutions/zod-to-openapi');
const { z } = require('zod');

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

// Define Schemas
const UserSchema = registry.register('User', z.object({
  id: z.number(),
  username: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['ADMIN', 'VIEWER', 'MAINTENANCE_CREW'])
}));

const POSchema = registry.register('PurchaseOrder', z.object({
  id: z.number(),
  vendor: z.string(),
  budget: z.number(),
  status: z.string(),
  idempotency_key: z.string()
}));

// Define Endpoints
registry.registerPath({
  method: 'post',
  path: '/purchase-orders',
  description: 'Create a new purchase order',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            vendor: z.string(),
            budget: z.number().positive(),
            request_date: z.string().optional(),
            gstin: z.string().optional(),
            department: z.string().optional(),
            billing_address: z.string().optional(),
            delivery_address: z.string().optional()
          })
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Created successfully',
      content: { 'application/json': { schema: POSchema } }
    }
  }
});

function generateSpec() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Core Service API',
      description: 'API documentation for the IT WMS Core Service'
    },
    servers: [{ url: 'http://localhost:3000' }]
  });
}

module.exports = { generateSpec, registry };
