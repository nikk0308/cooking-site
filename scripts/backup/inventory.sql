SELECT jsonb_build_object(
 'tables', (SELECT coalesce(jsonb_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public'),
 'columns', (SELECT coalesce(jsonb_agg(jsonb_build_array(table_name,column_name,data_type,udt_name,is_nullable,column_default,is_generated,generation_expression,numeric_precision,numeric_scale) ORDER BY table_name,ordinal_position),'[]') FROM information_schema.columns WHERE table_schema='public'),
 'constraints', (SELECT coalesce(jsonb_agg(jsonb_build_array(r.relname,c.conname,pg_get_constraintdef(c.oid),c.convalidated,c.condeferrable,c.condeferred) ORDER BY r.relname,c.conname),'[]') FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public'),
 'indexes', (SELECT coalesce(jsonb_agg(jsonb_build_array(tablename,indexname,indexdef) ORDER BY tablename,indexname),'[]') FROM pg_indexes WHERE schemaname='public'),
 'extensions', (SELECT jsonb_agg(jsonb_build_array(extname,extversion) ORDER BY extname) FROM pg_extension),
 'functions', (SELECT coalesce(jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid)) ORDER BY p.proname,p.oid),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')),
 'triggers', (SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) ORDER BY c.relname,t.tgname),'[]') FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),
 'enums', (SELECT jsonb_agg(jsonb_build_array(t.typname,e.enumlabel,e.enumsortorder) ORDER BY t.typname,e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'),
 'units', (SELECT jsonb_agg(to_jsonb(u) ORDER BY code) FROM (SELECT id,code,name,symbol,dimension,factor_to_base::text FROM public.units) u),
 'migrations', (SELECT jsonb_agg(jsonb_build_array(id,hash,created_at) ORDER BY id) FROM drizzle.__drizzle_migrations)
) AS inventory;
