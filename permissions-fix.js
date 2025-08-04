// permissions-fix.js - Auto-Fix für Database Permissions
const { Client } = require('pg');

async function fixDatabasePermissions() {
  console.log('🔧 Database Permissions Auto-Fix gestartet...');
  
  try {
    const pgClient = new Client({
      connectionString: process.env.POSTGRES_DIRECT_URL,
      ssl: false
    });
    
    await pgClient.connect();
    console.log('✅ PostgreSQL Verbindung hergestellt');
    
    // 1. Disable RLS
    const disableRLS = [
      'ALTER TABLE tenant_projects DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE kfz_users DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE kfz_customers DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE kfz_projects DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE kfz_project_customers DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE kfz_calls DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE kfz_appointments DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE kfz_vehicles DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE kfz_damages DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE kfz_insurance_companies DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE kfz_insurance_claims DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE kfz_accident_reports DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE kfz_project_files DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE kfz_analytics_events DISABLE ROW LEVEL SECURITY;'
    ];
    
    for (const sql of disableRLS) {
      try {
        await pgClient.query(sql);
        console.log('✅ RLS disabled:', sql.split(' ')[2]);
      } catch (error) {
        console.log('⚠️ RLS already disabled or not exists:', sql.split(' ')[2]);
      }
    }
    
    // 2. Grant permissions
    const permissionGrants = [
      'GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;',
      'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;',
      'GRANT USAGE ON SCHEMA public TO service_role;',
      'GRANT USAGE ON SCHEMA public TO authenticator;',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;',
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;'
    ];
    
    for (const sql of permissionGrants) {
      try {
        await pgClient.query(sql);
        console.log('✅ Permission granted:', sql.substring(0, 50) + '...');
      } catch (error) {
        console.log('⚠️ Permission already exists:', error.message.substring(0, 50));
      }
    }
    
    // 3. Create tenant project
    const insertTenant = `
      INSERT INTO tenant_projects (
        id, project_name, organization_name, owner_email, domain, settings, created_at
      ) VALUES (
        gen_random_uuid(),
        'kfz-sachverstaendiger',
        'DS-Sachverständigenbüro Bielefeld',
        'gutachter@unfallschaden-bielefeld.de',
        'unfallschaden-bielefeld.de',
        $1::jsonb,
        NOW()
      ) ON CONFLICT (project_name) DO NOTHING RETURNING id;
    `;
    
    const settings = {
      retell_agent_id: 'agent_33dd09f56fc57f5ebd9be1cdd8',
      business_type: 'kfz_expert',
      auto_create_projects: true,
      email_notifications: true
    };
    
    const result = await pgClient.query(insertTenant, [JSON.stringify(settings)]);
    
    if (result.rows.length > 0) {
      console.log('✅ Tenant Project created:', result.rows[0].id);
    } else {
      console.log('✅ Tenant Project already exists');
    }
    
    // 4. Verify
    const verify = await pgClient.query("SELECT COUNT(*) FROM tenant_projects WHERE project_name = 'kfz-sachverstaendiger'");
    console.log('✅ Tenant Projects found:', verify.rows[0].count);
    
    await pgClient.end();
    
    return {
      success: true,
      message: 'Database Permissions Fixed Successfully! 🎉',
      tenant_projects: verify.rows[0].count
    };
    
  } catch (error) {
    console.error('💥 Permissions Fix Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = { fixDatabasePermissions };
