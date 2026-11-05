// Shared by the main process and the renderer (no Node imports here): the "ready when"
// condition of a saved command. See readiness.ts for how it's checked.

export type ReadyType =
  | 'none'
  | 'container'
  | 'port'
  | 'url'
  | 'output'
  | 'quiet';

export interface ReadyCheck {
  type: ReadyType;
  target: string; // container name / [host:]port / URL / text or /regex/ / seconds
  timeout: number; // seconds, 0 = no limit
}

export const DEFAULT_READY_TIMEOUT = 120;

export const describeReady = (check?: ReadyCheck | null) => {
  if (!check || check.type === 'none') return '';
  switch (check.type) {
    case 'container':
      return `container ${check.target} ready`;
    case 'port':
      return `port ${check.target} open`;
    case 'url':
      return `${check.target} responds`;
    case 'output':
      return `output contains ${check.target}`;
    case 'quiet':
      return `output quiet for ${Number(check.target) || 3} s`;
    default:
      return '';
  }
};
