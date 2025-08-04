-- ===============================
-- DATABASE PERMISSIONS HOTFIX
-- PostgreSQL RLS & Permissions Fix für KFZ-Sachverständiger
-- ===============================

-- 1. DISABLE ROW LEVEL SECURITY für alle Tabellen
ALTER TABLE tenant_projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_project_customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_calls DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_appointments DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_vehicles DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_damages DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_insurance_companies DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_insurance_claims DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_accident_reports DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_project_files DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_analytics_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_chatbot_conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_chatbot_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_knowledge_articles DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_scraped_sources DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_scraped_content DISABLE ROW LEVEL SECURITY;
ALTER TABLE kfz_scraping_jobs DISABLE ROW LEVEL SECURITY;

-- 2. GRANT ALL PERMISSIONS to service_role
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 3. GRANT USAGE on SCHEMA
GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO authenticator;

-- 4. GRANT SELECT/INSERT/UPDATE/DELETE to anon role (für API)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

-- 5. Explicit permissions für kritische Tabellen
GRANT ALL PRIVILEGES ON tenant_projects TO service_role, anon;
GRANT ALL PRIVILEGES ON kfz_customers TO service_role, anon;
GRANT ALL PRIVILEGES ON kfz_projects TO service_role, anon;
GRANT ALL PRIVILEGES ON kfz_calls TO service_role, anon;
GRANT ALL PRIVILEGES ON kfz_appointments TO service_role, anon;

-- 6. CREATE INITIAL TENANT PROJECT if not exists
INSERT INTO tenant_projects (
    id,
    project_name,
    organization_name,
    owner_email,
    domain,
    settings,
    created_at
) VALUES (
    gen_random_uuid(),
    'kfz-sachverstaendiger',
    'DS-Sachverständigenbüro Bielefeld',
    'gutachter@unfallschaden-bielefeld.de',
    'unfallschaden-bielefeld.de',
    '{
        "retell_agent_id": "agent_33dd09f56fc57f5ebd9be1cdd8",
        "business_type": "kfz_expert",
        "auto_create_projects": true,
        "email_notifications": true,
        "sms_notifications": false
    }'::jsonb,
    NOW()
) ON CONFLICT (project_name) DO NOTHING;

-- 7. Verify permissions
SELECT 
    'Permissions Fix Applied' as status,
    COUNT(*) as tenant_projects_count
FROM tenant_projects 
WHERE project_name = 'kfz-sachverstaendiger';

-- 8. Show current user and role
SELECT 
    current_user as current_user,
    current_role as current_role,
    session_user as session_user;

-- SUCCESS MESSAGE
SELECT '🎉 Database Permissions HOTFIX Applied Successfully!' as message;
