const { Client } = require('pg');
const bcrypt = require('bcrypt');

// Configuración de conexión
const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'Webway',
  user: 'postgres',
  password: 'ALPXZVMspovGYMKjbXAeskPFPzVBeXKW' // CAMBIA ESTO
});

// Tus POIs
const pois = [
  {
    "id": 0,
    "name": "Bloque A",
    "lat": 4.6609819622582,
    "lon": -74.0596161549797,
    "description": "Edificio principal de aulas con laboratorios de computación y salas de estudio. Cuenta con 4 pisos y acceso a WiFi en todas las áreas.",
    "category": "academico"
  },
  {
    "id": 1,
    "name": "Bloque B",
    "lat": 4.6612256555812,
    "lon": -74.0595379523924,
    "description": "Centro de recursos académicos con biblioteca, salas de lectura y espacios de trabajo colaborativo. Horario extendido hasta las 9pm.",
    "category": "academico"
  },
  {
    "id": 4,
    "name": "Bloque F",
    "lat": 4.6611701025415,
    "lon": -74.0597040270357,
    "description": "Edificio de ciencias con laboratorios especializados de química, física y biología. Incluye auditorio para conferencias.",
    "category": "academico"
  },
  {
    "id": 6,
    "name": "PRIME",
    "lat": 4.6615260954136,
    "lon": -74.0595618398411,
    "description": "Centro de innovación y emprendimiento. Espacio de coworking, salas de reuniones y área de prototipado para proyectos estudiantiles.",
    "category": "servicios"
  },
  {
    "id": 8,
    "name": "Colores",
    "lat": 4.6612381266711,
    "lon": -74.0593889402125,
    "description": "Zona de recreación y descanso al aire libre. Áreas verdes, bancas y punto de encuentro estudiantil con máquinas expendedoras.",
    "category": "recreacion"
  },
  {
    "id": 9,
    "name": "Cafetería principal",
    "lat": 4.6611156832330,
    "lon": -74.0595288524120,
    "description": "Servicio de alimentación con variedad de menús, snacks y bebidas. Horario de 7am a 7pm. Acepta pagos con tarjeta y efectivo.",
    "category": "servicios"
  }
];

async function initializeDatabase() {
  try {
    await client.connect();
    console.log('Conectado a PostgreSQL\n');

    
    await client.query(`
      CREATE TABLE IF NOT EXISTS pois (
        id INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        description TEXT,
        category VARCHAR(100),
        image_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Tabla pois creada\n');

   
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_types (
        id SERIAL PRIMARY KEY,
        type_name VARCHAR(50) NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Tabla user_types creada\n');

    await client.query(`
      CREATE TABLE IF NOT EXISTS administrators (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        full_name VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        created_by INTEGER REFERENCES administrators(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      );
    `);
    console.log('Tabla administrators creada\n');

    // 4. Crear tabla de sesiones
    await client.query(`
      CREATE TABLE IF NOT EXISTS usage_sessions (
        id SERIAL PRIMARY KEY,
        user_type_id INTEGER REFERENCES user_types(id),
        ip_address VARCHAR(45),
        device_info TEXT,
        session_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        session_end TIMESTAMP,
        duration_seconds INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Tabla usage_sessions creada\n');

    // 5. Crear tabla de navegaciones
    await client.query(`
      CREATE TABLE IF NOT EXISTS poi_navigations (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES usage_sessions(id) ON DELETE CASCADE,
        poi_id INTEGER REFERENCES pois(id),
        user_type_id INTEGER REFERENCES user_types(id),
        navigation_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        origin_latitude DOUBLE PRECISION,
        origin_longitude DOUBLE PRECISION,
        duration_seconds INTEGER,
        distance_meters DOUBLE PRECISION,
        completed BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Tabla poi_navigations creada\n');

    // 6. Crear tabla de búsquedas
    await client.query(`
      CREATE TABLE IF NOT EXISTS search_logs (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES usage_sessions(id) ON DELETE CASCADE,
        search_query TEXT,
        results_count INTEGER,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Tabla search_logs creada\n');

    // 7. Insertar tipos de usuario
    await client.query(`
      INSERT INTO user_types (type_name, description) VALUES
        ('visitante', 'Persona externa visitando el campus'),
        ('estudiante', 'Estudiante de la universidad'),
        ('trabajador', 'Personal administrativo o docente')
      ON CONFLICT (type_name) DO NOTHING;
    `);
    console.log('Tipos de usuario insertados\n');

    // 8. Insertar POIs
    console.log('📍 Insertando POIs...');
    await client.query('DELETE FROM pois');
    for (const poi of pois) {
      await client.query(
        'INSERT INTO pois (id, name, latitude, longitude, description, category) VALUES ($1, $2, $3, $4, $5, $6)',
        [poi.id, poi.name, poi.lat, poi.lon, poi.description, poi.category]
      );
    }
    console.log(`${pois.length} POIs insertados\n`);

    // 9. Crear administrador por defecto
    const passwordHash = await bcrypt.hash('admin123', 10);
    await client.query(`
      INSERT INTO administrators (username, password_hash, email, full_name) 
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (username) DO NOTHING;
    `, ['admin', passwordHash, 'admin@usa.edu.co', 'Administrador Principal']);
    console.log('✅ Administrador creado');
    console.log('   Usuario: admin');
    console.log('   Contraseña: admin123');

    // 10. Crear índices
    await client.query('CREATE INDEX IF NOT EXISTS idx_poi_navigations_poi_id ON poi_navigations(poi_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_poi_navigations_user_type ON poi_navigations(user_type_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_poi_navigations_timestamp ON poi_navigations(navigation_timestamp)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_usage_sessions_timestamp ON usage_sessions(session_start)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_usage_sessions_user_type ON usage_sessions(user_type_id)');
    console.log('✅ Índices creados\n');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

initializeDatabase();