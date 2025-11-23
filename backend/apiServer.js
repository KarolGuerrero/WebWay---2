
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const port = 3000;

// Configuración de PostgreSQL
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'Webway',
  user: 'postgres',
  password: 'Postgres' // CAMBIA ESTO
});

// Secret para JWT (en producción usar variable de entorno)
const JWT_SECRET = 'c4f91e9c1b8d4f6fa2d7e3ab94c0f7d1e8b3a6df4c9e72b1a5d0c3f8b7e4a29c';

// Middleware
app.use(cors());
app.use(express.json());

// Middleware para obtener IP del cliente
app.use((req, res, next) => {
  req.clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  next();
});

// Middleware de autenticación para rutas de admin
const authenticateAdmin = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ success: false, message: 'Token no proporcionado' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      'SELECT id, username, email, full_name FROM administrators WHERE id = $1 AND is_active = true',
      [decoded.adminId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Administrador no válido' });
    }

    req.admin = result.rows[0];
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token inválido' });
  }
};

// ═══════════════════════════════════════════════════════════
// ENDPOINTS PÚBLICOS (para la app de AR)
// ═══════════════════════════════════════════════════════════

// 1. Obtener todos los POIs
app.get('/api/pois', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM pois ORDER BY name');
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Obtener un POI por ID
app.get('/api/pois/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM pois WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'POI no encontrado' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Obtener tipos de usuario disponibles
app.get('/api/user-types', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, type_name, description FROM user_types ORDER BY id');
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Iniciar sesión (cuando el usuario selecciona su tipo)
app.post('/api/session/start', async (req, res) => {
  try {
    const { user_type_id, device_info } = req.body;

    if (!user_type_id) {
      return res.status(400).json({ success: false, message: 'user_type_id es requerido' });
    }

    const result = await pool.query(
      `INSERT INTO usage_sessions (user_type_id, ip_address, device_info, session_start) 
       VALUES ($1, $2, $3, NOW()) 
       RETURNING id, session_start`,
      [user_type_id, req.clientIp, device_info || null]
    );

    res.json({ 
      success: true, 
      message: 'Sesión iniciada',
      session_id: result.rows[0].id,
      session_start: result.rows[0].session_start
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Finalizar sesión
app.post('/api/session/end', async (req, res) => {
  try {
    const { session_id } = req.body;

    if (!session_id) {
      return res.status(400).json({ success: false, message: 'session_id es requerido' });
    }

    const result = await pool.query(
      `UPDATE usage_sessions 
       SET session_end = NOW(), 
           duration_seconds = EXTRACT(EPOCH FROM (NOW() - session_start))::INTEGER
       WHERE id = $1
       RETURNING duration_seconds`,
      [session_id]
    );

    res.json({ 
      success: true, 
      message: 'Sesión finalizada',
      duration_seconds: result.rows[0]?.duration_seconds 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. Registrar navegación a un POI
app.post('/api/navigation', async (req, res) => {
  try {
    const { 
      session_id, 
      poi_id, 
      user_type_id,
      origin_latitude, 
      origin_longitude,
      duration_seconds,
      distance_meters,
      completed 
    } = req.body;

    if (!session_id || !poi_id || !user_type_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'session_id, poi_id y user_type_id son requeridos' 
      });
    }

    const result = await pool.query(
      `INSERT INTO poi_navigations 
       (session_id, poi_id, user_type_id, origin_latitude, origin_longitude, 
        duration_seconds, distance_meters, completed) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [session_id, poi_id, user_type_id, origin_latitude, origin_longitude, 
       duration_seconds, distance_meters, completed || false]
    );

    res.json({ 
      success: true, 
      message: 'Navegación registrada',
      navigation_id: result.rows[0].id 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 7. Registrar búsqueda
app.post('/api/search', async (req, res) => {
  try {
    const { session_id, search_query, results_count } = req.body;

    await pool.query(
      'INSERT INTO search_logs (session_id, search_query, results_count) VALUES ($1, $2, $3)',
      [session_id, search_query, results_count || 0]
    );

    res.json({ success: true, message: 'Búsqueda registrada' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════
// ENDPOINTS DE AUTENTICACIÓN (ADMIN)
// ═══════════════════════════════════════════════════════════

// 8. Login de administrador
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Usuario y contraseña requeridos' });
    }

    const result = await pool.query(
      'SELECT id, username, password_hash, email, full_name FROM administrators WHERE username = $1 AND is_active = true',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }

    const admin = result.rows[0];
    const validPassword = await bcrypt.compare(password, admin.password_hash);

    if (!validPassword) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }

    // Actualizar último login
    await pool.query('UPDATE administrators SET last_login = NOW() WHERE id = $1', [admin.id]);

    // Generar token JWT
    const token = jwt.sign({ adminId: admin.id, username: admin.username }, JWT_SECRET, { 
      expiresIn: '24h' 
    });

    res.json({
      success: true,
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        full_name: admin.full_name
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════
// ENDPOINTS DE DASHBOARD (requieren autenticación)
// ═══════════════════════════════════════════════════════════

// 9. Estadísticas generales
app.get('/api/admin/stats/general', authenticateAdmin, async (req, res) => {
  try {
    // Total de sesiones
    const totalSessions = await pool.query('SELECT COUNT(*) as count FROM usage_sessions');
    
    // Sesiones por tipo de usuario
    const sessionsByType = await pool.query(`
      SELECT ut.type_name, COUNT(us.id) as count
      FROM usage_sessions us
      JOIN user_types ut ON us.user_type_id = ut.id
      GROUP BY ut.type_name
      ORDER BY count DESC
    `);

    // Total de navegaciones
    const totalNavigations = await pool.query('SELECT COUNT(*) as count FROM poi_navigations');

    // POI más visitado
    const mostVisitedPOI = await pool.query(`
      SELECT p.name, p.id, COUNT(pn.id) as visits
      FROM poi_navigations pn
      JOIN pois p ON pn.poi_id = p.id
      GROUP BY p.id, p.name
      ORDER BY visits DESC
      LIMIT 1
    `);

    // POI menos visitado
    const leastVisitedPOI = await pool.query(`
      SELECT p.name, p.id, COALESCE(COUNT(pn.id), 0) as visits
      FROM pois p
      LEFT JOIN poi_navigations pn ON p.id = pn.poi_id
      GROUP BY p.id, p.name
      ORDER BY visits ASC
      LIMIT 1
    `);

    res.json({
      success: true,
      data: {
        total_sessions: parseInt(totalSessions.rows[0].count),
        sessions_by_type: sessionsByType.rows,
        total_navigations: parseInt(totalNavigations.rows[0].count),
        most_visited_poi: mostVisitedPOI.rows[0],
        least_visited_poi: leastVisitedPOI.rows[0]
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 10. Ranking de POIs por visitas
app.get('/api/admin/stats/poi-ranking', authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.id,
        p.name,
        p.category,
        COALESCE(COUNT(pn.id), 0) as total_visits,
        COALESCE(COUNT(DISTINCT pn.session_id), 0) as unique_visitors,
        COALESCE(AVG(pn.duration_seconds), 0)::INTEGER as avg_duration_seconds
      FROM pois p
      LEFT JOIN poi_navigations pn ON p.id = pn.poi_id
      GROUP BY p.id, p.name, p.category
      ORDER BY total_visits DESC
    `);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 11. Uso por hora del día
app.get('/api/admin/stats/usage-by-hour', authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        EXTRACT(HOUR FROM navigation_timestamp) as hour,
        COUNT(*) as navigations
      FROM poi_navigations
      GROUP BY hour
      ORDER BY hour
    `);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 12. Uso por día de la semana
app.get('/api/admin/stats/usage-by-day', authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        TO_CHAR(navigation_timestamp, 'Day') as day_name,
        EXTRACT(DOW FROM navigation_timestamp) as day_number,
        COUNT(*) as navigations
      FROM poi_navigations
      GROUP BY day_name, day_number
      ORDER BY day_number
    `);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 13. Navegaciones recientes
app.get('/api/admin/stats/recent-navigations', authenticateAdmin, async (req, res) => {
  try {
    const limit = req.query.limit || 20;
    const result = await pool.query(`
      SELECT 
        pn.id,
        p.name as poi_name,
        ut.type_name as user_type,
        pn.navigation_timestamp,
        pn.duration_seconds,
        pn.distance_meters,
        pn.completed
      FROM poi_navigations pn
      JOIN pois p ON pn.poi_id = p.id
      JOIN user_types ut ON pn.user_type_id = ut.id
      ORDER BY pn.navigation_timestamp DESC
      LIMIT $1
    `, [limit]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 14. Búsquedas más comunes
app.get('/api/admin/stats/popular-searches', authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        search_query,
        COUNT(*) as search_count,
        AVG(results_count)::INTEGER as avg_results
      FROM search_logs
      WHERE search_query IS NOT NULL
      GROUP BY search_query
      ORDER BY search_count DESC
      LIMIT 20
    `);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════
// GESTIÓN DE ADMINISTRADORES
// ═══════════════════════════════════════════════════════════

// 15. Listar administradores
app.get('/api/admin/administrators', authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, username, email, full_name, is_active, created_at, last_login
      FROM administrators
      ORDER BY created_at DESC
    `);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 16. Crear nuevo administrador
app.post('/api/admin/administrators', authenticateAdmin, async (req, res) => {
  try {
    const { username, password, email, full_name } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Usuario y contraseña requeridos' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO administrators (username, password_hash, email, full_name, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, full_name`,
      [username, passwordHash, email, full_name, req.admin.id]
    );

    res.json({ 
      success: true, 
      message: 'Administrador creado exitosamente',
      data: result.rows[0] 
    });
  } catch (error) {
    if (error.code === '23505') { 
      res.status(400).json({ success: false, message: 'El nombre de usuario ya existe' });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// 17. Desactivar administrador
app.delete('/api/admin/administrators/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // No permitir que se desactive a sí mismo
    if (parseInt(id) === req.admin.id) {
      return res.status(400).json({ success: false, message: 'No puedes desactivarte a ti mismo' });
    }

    await pool.query(
      'UPDATE administrators SET is_active = false WHERE id = $1',
      [id]
    );

    res.json({ success: true, message: 'Administrador desactivado' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`\n🚀 API ejecutándose en http://localhost:${port}\n`);
});