"""Pure capability tests; no Docker calls, credentials or network."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('broker', Path(__file__).parent / 'backup/docker_broker.py')
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)


class BrokerCapabilityTests(unittest.TestCase):
    def setUp(self):
        self.config = {'app_container': 'fixture-app', 'pg_container': 'fixture-pg', 'database': 'fixture_db', 'database_user': 'fixture_reader', 'pg_uid': 70}

    def test_exact_dump_and_list_only_run_as_nonroot_pg_user(self):
        dump = ['exec', '-i', 'fixture-pg', 'pg_dump', '-U', 'fixture_reader', '-d', 'fixture_db', '-Fc', '--snapshot=00000003-0000001A-1']
        result = broker.authorize(self.config, dump, 0)
        self.assertEqual(result[:5], ['exec', '--user', '70', '-i', 'fixture-pg'])
        self.assertEqual(broker.authorize(self.config, ['exec', '-i', 'fixture-pg', 'pg_restore', '--list'], 128)[5:], ['pg_restore', '--list'])

    def test_other_container_shell_restore_or_arbitrary_sql_are_denied(self):
        for args in [
            ['run', '--privileged', 'fixture'],
            ['exec', '-i', 'fixture-app', 'sh'],
            ['exec', '-i', 'fixture-pg', 'sh'],
            ['exec', '-i', 'fixture-pg', 'pg_restore', '-d', 'fixture_db'],
            ['inspect', 'fixture-app'],
            ['inspect', '--format', '{{json .Config.Env}}', 'fixture-app'],
            ['exec', '-i', 'fixture-pg', 'psql', '-c', 'DROP DATABASE fixture_db'],
            ['exec', '-i', 'fixture-pg', 'pg_dump', '-U', 'other', '-d', 'fixture_db', '-Fc', '--snapshot=00000003-0000001A-1'],
            ['exec', '-i', 'fixture-pg', 'pg_dump', '-U', 'fixture_reader', '-d', 'other', '-Fc', '--snapshot=00000003-0000001A-1'],
        ]:
            with self.subTest(operation=args[0]), self.assertRaises(ValueError):
                broker.authorize(self.config, args, 0)

    def test_input_and_snapshot_limits(self):
        for size in [-1, broker.MAX_INPUT + 1]:
            with self.assertRaises(ValueError):
                broker.authorize(self.config, ['exec', '-i', 'fixture-pg', 'pg_restore', '--list'], size)
        with self.assertRaises(ValueError):
            broker.authorize(self.config, ['exec', '-i', 'fixture-pg', 'pg_restore', '--list'], 0)
        for suffix in ['--snapshot=x;sh', '--file=/tmp/anything', '--snapshot=1-2-3 --clean']:
            with self.assertRaises(ValueError):
                broker.authorize(self.config, ['exec', '-i', 'fixture-pg', 'pg_dump', '-U', 'fixture_reader', '-d', 'fixture_db', '-Fc', suffix], 0)

    def test_inspect_never_returns_environment(self):
        allowed = ['inspect', '--format', broker.CONTRACT['runtimeInspect'], 'fixture-app']
        self.assertEqual(broker.authorize(self.config, allowed, 0), allowed)
        self.assertNotIn('.Config.Env', broker.CONTRACT['runtimeInspect'])


if __name__ == '__main__':
    unittest.main()
