// A template's os is the image server alias <distro>/<version> (titan-ops features/vm/design.md#vm-create-form);
// the distro names the family the create form groups templates by. Distro names are product names: no translation.
const FAMILY_LABELS: Record<string, string> = {
  ubuntu: 'Ubuntu',
  almalinux: 'AlmaLinux',
  rockylinux: 'Rocky Linux',
  debian: 'Debian',
  fedora: 'Fedora',
}

export interface TemplateFamily {
  key: string
  label: string
}

export function templateFamily(os: string): TemplateFamily {
  const key = os.split('/')[0]
  const label = FAMILY_LABELS[key]
  if (label === undefined) {
    return { key, label: key }
  }
  return { key, label }
}
