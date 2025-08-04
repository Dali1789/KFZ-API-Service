-- ===============================
-- FEHLENDE 9 PREMIUM-QUELLEN ERSTELLEN
-- Diese müssen Sie in Supabase SQL Editor ausführen!
-- ===============================

INSERT INTO kfz_scraped_sources (
    tenant_project_id, 
    source_name, 
    base_url, 
    scraping_rules,
    scrape_frequency,
    auto_approve,
    content_quality_threshold,
    status
) VALUES 

-- BVSK - Bundesverband (4 Quellen)
('8718ff92-0e7b-41fb-9c71-253d3d708764', 'BVSK - Infos für Autofahrer', 'https://www.bvsk.de/informationen/infos-fuer-autofahrer/', '{"max_pages_per_session": 8, "delay_between_requests": 3000, "content_selectors": [".content", ".article-content"], "title_selector": "h1, h2.title", "respect_robots_txt": true}', 'weekly', false, 0.90, 'active'),

('8718ff92-0e7b-41fb-9c71-253d3d708764', 'BVSK - Infos für KFZ-Betriebe', 'https://www.bvsk.de/informationen/infos-fuer-kfz-betriebe/', '{"max_pages_per_session": 5, "delay_between_requests": 4000, "content_selectors": [".content", ".article-content"], "title_selector": "h1, h2.title", "respect_robots_txt": true}', 'monthly', false, 0.95, 'active'),

('8718ff92-0e7b-41fb-9c71-253d3d708764', 'BVSK - Rechtliche Infos', 'https://www.bvsk.de/informationen/infos-fuer-rechtsanwaelte/', '{"max_pages_per_session": 5, "delay_between_requests": 5000, "content_selectors": [".content", ".article-content"], "title_selector": "h1, h2.title", "respect_robots_txt": true}', 'monthly', false, 0.98, 'active'),

('8718ff92-0e7b-41fb-9c71-253d3d708764', 'BVSK - Presseinfos', 'https://www.bvsk.de/informationen/presseinfos/', '{"max_pages_per_session": 10, "delay_between_requests": 2000, "content_selectors": [".content", ".press-content"], "title_selector": "h1, h2.title", "respect_robots_txt": true}', 'weekly', false, 0.80, 'active'),

-- Fachportale (3 Quellen)
('8718ff92-0e7b-41fb-9c71-253d3d708764', 'Versicherungsrecht Siegen', 'https://www.versicherungsrechtsiegen.de/', '{"max_pages_per_session": 12, "delay_between_requests": 3000, "content_selectors": [".content", ".post-content"], "title_selector": "h1, .entry-title", "respect_robots_txt": true}', 'weekly', false, 0.92, 'active'),

('8718ff92-0e7b-41fb-9c71-253d3d708764', 'AutoCrashExpert - Gutachter-Praxis', 'https://www.autocrashexpert.de/', '{"max_pages_per_session": 15, "delay_between_requests": 3000, "content_selectors": [".content", ".post-content"], "title_selector": "h1, .entry-title", "respect_robots_txt": true}', 'weekly', false, 0.85, 'active'),

('8718ff92-0e7b-41fb-9c71-253d3d708764', 'KFZ-Gutachter Deutschland Archiv', 'https://kfz-gutachter-deutschland.de/archiv/', '{"max_pages_per_session": 15, "delay_between_requests": 3500, "content_selectors": [".content", ".archiv-content"], "title_selector": "h1, h2, .title", "respect_robots_txt": true}', 'monthly', false, 0.90, 'active'),

-- Unternehmen & Magazine (2 Quellen)
('8718ff92-0e7b-41fb-9c71-253d3d708764', 'Hüsges Gruppe - Sachverständige', 'https://www.huesges-gruppe.de/de/', '{"max_pages_per_session": 8, "delay_between_requests": 4000, "content_selectors": [".content", ".text-content"], "title_selector": "h1, h2", "respect_robots_txt": true}', 'monthly', false, 0.88, 'active'),

('8718ff92-0e7b-41fb-9c71-253d3d708764', 'Gutachterix Magazin', 'https://www.gutachterix.de/magazin/', '{"max_pages_per_session": 20, "delay_between_requests": 2500, "content_selectors": [".content", ".post-content"], "title_selector": "h1, .article-title", "respect_robots_txt": true}', 'weekly', false, 0.85, 'active');

-- Bestätigung
SELECT 
    COUNT(*) as total_sources,
    COUNT(CASE WHEN status = 'active' THEN 1 END) as active_sources,
    string_agg(source_name, E'\n') as all_sources
FROM kfz_scraped_sources 
WHERE tenant_project_id = '8718ff92-0e7b-41fb-9c71-253d3d708764';
