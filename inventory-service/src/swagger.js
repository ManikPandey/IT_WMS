const { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } = require('@asteasolutions/zod-to-openapi');
const { z } = require('zod');

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const AssetSchema = registry.register('Asset', z.object({
  id: z.number(),
  asset_tag: z.string(),
  name: z.string(),
  status: z.string(),
  category_id: z.number().nullable(),
  po_id: z.number().nullable(),
  serial_number: z.string().nullable(),
  jsonb_attributes: z.record(z.any()).nullable()
}));

registry.registerPath({
  method: 'post',
  path: '/assets',
  description: 'Create a new asset',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            asset_tag: z.string(),
            name: z.string(),
            category_id: z.number().optional(),
            po_id: z.number().optional(),
            serial_number: z.string().optional(),
            custom_attributes: z.record(z.any()).optional()
          })
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Created successfully',
      content: { 'application/json': { schema: AssetSchema } }
    }
  }
});

function generateSpec() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Inventory Service API',
      description: 'API documentation for the IT WMS Inventory Service'
    },
    servers: [{ url: 'http://localhost:3001' }]
  });
}

module.exports = { generateSpec, registry };
