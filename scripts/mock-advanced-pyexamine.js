#!/usr/bin/env node

const allGroups = {
  long_method: [
    {
      name: 'long_method',
      category: 'size_metric',
      entity: 'UserService.get_user',
      location: { file: 'sample.py', line_start: 1, line_end: 45 },
      severity: 'high',
      metrics: { lines: 45, threshold: 30 },
      related_locations: [],
      message: null,
    },
    {
      name: 'long_method',
      category: 'size_metric',
      entity: 'OrderService.create_order',
      location: { file: 'orders.py', line_start: 10, line_end: 42 },
      severity: 'medium',
      metrics: { lines: 33, threshold: 30 },
      related_locations: [],
      message: null,
    },
  ],
  data_clumps: [
    {
      name: 'data_clumps',
      category: 'abstraction_misuse_metric',
      entity: 'name, email, phone',
      location: { file: 'users.py', line_start: 12, line_end: 18 },
      severity: 'medium',
      metrics: { occurrences: 3 },
      related_locations: [],
      message: 'Introduce Parameter Object',
    },
  ],
  shotgun_surgery: [
    {
      name: 'shotgun_surgery',
      category: 'dependency_structure_metric',
      entity: 'UserRepository.save',
      location: { file: 'repository.py', line_start: 5, line_end: 9 },
      severity: 'high',
      metrics: { calling_files: 8 },
      related_locations: [],
      message: 'Changing this definition forces edits across files',
    },
  ],
};

function main() {
  const args = process.argv.slice(2);

  if (!args.includes('--json')) {
    console.error('mock advanced_pyexamine requires --json');
    process.exit(2);
  }

  const onlyIndex = args.indexOf('--only');
  if (onlyIndex === -1) {
    process.stdout.write(JSON.stringify(allGroups));
    return;
  }

  const only = args[onlyIndex + 1];
  if (!only) {
    console.error('--only requires a comma-separated detector list');
    process.exit(2);
  }

  const names = only.split(',').map((name) => name.trim()).filter(Boolean);
  const filtered = {};
  for (const name of names) {
    filtered[name] = allGroups[name] ?? [];
  }

  process.stdout.write(JSON.stringify(filtered));
}

main();
