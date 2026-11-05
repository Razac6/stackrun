// Icons a package can have (next to its color) - to spot "the database one" or "the
// frontend one" at a glance, in the list, inside other packages and in the run panel.
import React from 'react';
import type { SvgIconProps } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import StorageIcon from '@mui/icons-material/Storage';
import DnsIcon from '@mui/icons-material/Dns';
import WebIcon from '@mui/icons-material/Web';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import ApiIcon from '@mui/icons-material/Api';
import BoltIcon from '@mui/icons-material/Bolt';
import CloudIcon from '@mui/icons-material/Cloud';
import HubIcon from '@mui/icons-material/Hub';
import LayersIcon from '@mui/icons-material/Layers';
import TerminalIcon from '@mui/icons-material/Terminal';
import CodeIcon from '@mui/icons-material/Code';
import BuildIcon from '@mui/icons-material/Build';
import ScienceIcon from '@mui/icons-material/Science';
import BugReportIcon from '@mui/icons-material/BugReport';
import SyncIcon from '@mui/icons-material/Sync';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import LockIcon from '@mui/icons-material/Lock';
import EmailIcon from '@mui/icons-material/Email';
import ScheduleIcon from '@mui/icons-material/Schedule';
import type { PackageIcon } from './commandsModel';

const ICONS: Record<
  PackageIcon,
  { label: string; Icon: React.ComponentType<SvgIconProps> }
> = {
  folder: { label: 'Folder', Icon: FolderIcon },
  database: { label: 'Database', Icon: StorageIcon },
  server: { label: 'Backend / server', Icon: DnsIcon },
  web: { label: 'Frontend', Icon: WebIcon },
  mobile: { label: 'Mobile', Icon: SmartphoneIcon },
  api: { label: 'API', Icon: ApiIcon },
  functions: { label: 'Functions', Icon: BoltIcon },
  cloud: { label: 'Cloud', Icon: CloudIcon },
  stack: { label: 'Whole stack', Icon: LayersIcon },
  services: { label: 'Services', Icon: HubIcon },
  terminal: { label: 'Scripts', Icon: TerminalIcon },
  code: { label: 'Code', Icon: CodeIcon },
  build: { label: 'Build', Icon: BuildIcon },
  tests: { label: 'Tests', Icon: ScienceIcon },
  debug: { label: 'Debug', Icon: BugReportIcon },
  sync: { label: 'Sync / update', Icon: SyncIcon },
  deploy: { label: 'Deploy', Icon: RocketLaunchIcon },
  auth: { label: 'Auth', Icon: LockIcon },
  mail: { label: 'Mail', Icon: EmailIcon },
  jobs: { label: 'Jobs / cron', Icon: ScheduleIcon },
};

export const packageIconLabel = (icon: PackageIcon) => ICONS[icon].label;

export function PackageIconView({
  icon,
  ...props
}: { icon: PackageIcon | null | undefined } & SvgIconProps) {
  const { Icon } = ICONS[icon || 'folder'] || ICONS.folder;
  return <Icon {...props} />;
}
