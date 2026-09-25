import { PERMISSIONS, type Permission, type Role } from '@panel/lib/types'

const VIEWER: { name: Role; permissions: Permission[] } = {
  name: 'Viewer',
  permissions: ['view_projects'],
}

/** The panel's system roles (custom roles arrive with @dt/policy). Stored lowercase in Better Auth. */
const SYSTEM: Record<string, { name: Role; permissions: Permission[] }> = {
  admin: { name: 'Admin', permissions: [...PERMISSIONS] },
  supervisor: {
    name: 'Supervisor',
    permissions: [
      'edit_projects',
      'create_projects',
      'delete_projects',
      'access_settings',
      'view_projects',
      'edit_users',
      'view_logs',
      'manage_warehouse_addresses',
      'view_warehouse_addresses',
    ],
  },
  editor: {
    name: 'Editor',
    permissions: [
      'edit_projects',
      'create_projects',
      'delete_projects',
      'access_settings',
      'view_projects',
      'manage_warehouse_addresses',
      'view_warehouse_addresses',
    ],
  },
  viewer: VIEWER,
  address_manager: {
    name: 'AddressManager',
    permissions: ['view_warehouse_addresses', 'manage_warehouse_addresses', 'view_projects'],
  },
}

export function roleOf(stored: string | null | undefined): {
  name: Role
  permissions: Permission[]
} {
  return SYSTEM[stored ?? 'viewer'] ?? VIEWER
}
