import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataFilePath = path.resolve(__dirname, '../data/db.json');

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const minioConfig = {
  endpoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: Number(process.env.MINIO_PORT || 9000),
  bucket: process.env.MINIO_BUCKET || 'products',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
};

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  });
  res.end(JSON.stringify(payload));
};

const parseBody = async (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
    if (body.length > 10 * 1024 * 1024) {
      reject(new Error('Payload too large'));
    }
  });
  req.on('end', () => {
    if (!body) return resolve({});
    try {
      return resolve(JSON.parse(body));
    } catch {
      return reject(new Error('Invalid JSON body'));
    }
  });
  req.on('error', reject);
});

const ensureStorage = () => {
  const dataDir = path.dirname(dataFilePath);
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  if (!existsSync(dataFilePath)) {
    writeFileSync(dataFilePath, JSON.stringify({
      products: [],
      categories: [],
      filters: [],
      storeAddresses: [],
      minioFiles: [],
    }, null, 2));
  }
};

const readDb = () => {
  ensureStorage();
  return JSON.parse(readFileSync(dataFilePath, 'utf-8'));
};

const writeDb = (db) => {
  writeFileSync(dataFilePath, JSON.stringify(db, null, 2));
};

const signToken = (payload) => {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  return `${data}.${signature}`;
};

const verifyToken = (token) => {
  const [data, signature] = token.split('.');
  if (!data || !signature) return null;

  const expected = createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  const sigOk = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!sigOk) return null;

  const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'));
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
};

const requireAuth = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  return verifyToken(authHeader.slice(7));
};

const validateRequired = (fields, body) => fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');

const notFound = (res) => sendJson(res, 404, { message: 'Route not found' });

const listCollection = (res, collection) => {
  const db = readDb();
  return sendJson(res, 200, db[collection]);
};

const getCollectionItem = (res, collection, id) => {
  const db = readDb();
  const item = db[collection].find((entity) => entity.id === id);
  if (!item) return sendJson(res, 404, { message: `${collection} item not found` });
  return sendJson(res, 200, item);
};

const createCollectionItem = async (req, res, collection, requiredFields) => {
  if (!requireAuth(req)) return sendJson(res, 401, { message: 'Unauthorized' });
  const body = await parseBody(req);
  const missing = validateRequired(requiredFields, body);
  if (missing.length) return sendJson(res, 400, { message: `Required fields: ${missing.join(', ')}` });

  const db = readDb();
  const entity = {
    id: randomUUID(),
    ...body,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db[collection].push(entity);
  writeDb(db);
  return sendJson(res, 201, entity);
};

const updateCollectionItem = async (req, res, collection, id) => {
  if (!requireAuth(req)) return sendJson(res, 401, { message: 'Unauthorized' });
  const body = await parseBody(req);
  const db = readDb();
  const index = db[collection].findIndex((entity) => entity.id === id);
  if (index === -1) return sendJson(res, 404, { message: `${collection} item not found` });

  db[collection][index] = {
    ...db[collection][index],
    ...body,
    id,
    updatedAt: new Date().toISOString(),
  };
  writeDb(db);
  return sendJson(res, 200, db[collection][index]);
};

const deleteCollectionItem = (req, res, collection, id) => {
  if (!requireAuth(req)) return sendJson(res, 401, { message: 'Unauthorized' });
  const db = readDb();
  const index = db[collection].findIndex((entity) => entity.id === id);
  if (index === -1) return sendJson(res, 404, { message: `${collection} item not found` });

  const [deleted] = db[collection].splice(index, 1);
  writeDb(db);
  return sendJson(res, 200, { deleted });
};

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      });
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, {
        status: 'ok',
        minio: {
          endpoint: `${minioConfig.endpoint}:${minioConfig.port}`,
          bucket: minioConfig.bucket,
          note: 'MinIO configured; S3 operations are proxied by metadata endpoint /admin/minio/upload-base64.',
        },
      });
    }

    if (req.method === 'POST' && pathname === '/auth/admin/login') {
      const body = await parseBody(req);
      if (body.login !== ADMIN_LOGIN || body.password !== ADMIN_PASSWORD) {
        return sendJson(res, 401, { message: 'Invalid credentials' });
      }

      const token = signToken({
        role: 'admin',
        login: body.login,
        exp: Date.now() + 12 * 60 * 60 * 1000,
      });
      return sendJson(res, 200, { token });
    }

    if (req.method === 'GET' && pathname === '/products') {
      const db = readDb();
      let products = [...db.products];

      const categoryId = url.searchParams.get('categoryId');
      const filterId = url.searchParams.get('filterId');
      const q = url.searchParams.get('q');

      if (categoryId) products = products.filter((item) => item.categoryId === categoryId);
      if (filterId) products = products.filter((item) => Array.isArray(item.filterIds) && item.filterIds.includes(filterId));
      if (q) products = products.filter((item) => String(item.name || '').toLowerCase().includes(q.toLowerCase()));

      return sendJson(res, 200, products);
    }

    if (req.method === 'GET' && pathname === '/categories') {
      return listCollection(res, 'categories');
    }

    const collectionConfigs = {
      products: ['name', 'price', 'categoryId'],
      categories: ['name'],
      filters: ['name'],
      'store-addresses': ['city', 'street'],
    };

    const adminPathMatch = pathname.match(/^\/admin\/(products|categories|filters|store-addresses)(?:\/([^/]+))?$/);

    if (adminPathMatch) {
      const routeName = adminPathMatch[1];
      const id = adminPathMatch[2];
      const collection = routeName === 'store-addresses' ? 'storeAddresses' : routeName;
      const required = collectionConfigs[routeName];

      if (req.method === 'GET' && !id) return listCollection(res, collection);
      if (req.method === 'GET' && id) return getCollectionItem(res, collection, id);
      if (req.method === 'POST' && !id) return createCollectionItem(req, res, collection, required);
      if (req.method === 'PUT' && id) return updateCollectionItem(req, res, collection, id);
      if (req.method === 'DELETE' && id) return deleteCollectionItem(req, res, collection, id);
    }

    if (req.method === 'POST' && pathname === '/admin/minio/upload-base64') {
      if (!requireAuth(req)) return sendJson(res, 401, { message: 'Unauthorized' });
      const body = await parseBody(req);
      if (!body.fileName || !body.base64) {
        return sendJson(res, 400, { message: 'fileName and base64 are required' });
      }

      const db = readDb();
      const fileRecord = {
        id: randomUUID(),
        fileName: body.fileName,
        bucket: minioConfig.bucket,
        contentType: body.contentType || 'application/octet-stream',
        bytes: Buffer.from(body.base64, 'base64').byteLength,
        uploadedAt: new Date().toISOString(),
        minioEndpoint: `${minioConfig.endpoint}:${minioConfig.port}`,
      };
      db.minioFiles.push(fileRecord);
      writeDb(db);

      return sendJson(res, 201, fileRecord);
    }

    return notFound(res);
  } catch (error) {
    return sendJson(res, 500, { message: 'Internal server error', error: String(error.message || error) });
  }
});

ensureStorage();
server.listen(PORT, () => {
  console.log(`Backend started on http://localhost:${PORT}`);
});
