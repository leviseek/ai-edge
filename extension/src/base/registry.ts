/** 基座：插件注册表与生命周期管理 */
import type { Disposer } from './message-bus';
import type { Logger } from './logger';

export type PluginState = 'registered' | 'activating' | 'active' | 'deactivating' | 'inactive' | 'error';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  dependsOn?: string[];
  /** 声明所需能力/权限（白名单概念，供未来清单校验） */
  permissions?: string[];
}

export interface EdgePlugin<C = unknown> {
  manifest: PluginManifest;
  activate(ctx: C): void | Promise<void>;
  deactivate(): void | Promise<void>;
}

export interface PluginInstance<C> {
  manifest: PluginManifest;
  state: PluginState;
  error?: string;
  create: () => EdgePlugin<C>;
  plugin?: EdgePlugin<C>;
}

export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  state: PluginState;
  error?: string;
}

export type StateListener<C> = (id: string, state: PluginState, inst: PluginInstance<C>) => void;

export class PluginRegistry<C> {
  private instances = new Map<string, PluginInstance<C>>();
  private stateListeners = new Set<StateListener<C>>();

  constructor(private readonly log: Logger) {}

  register(manifest: PluginManifest, create: () => EdgePlugin<C>): Disposer {
    if (this.instances.has(manifest.id)) throw new Error(`插件已注册: ${manifest.id}`);
    const inst: PluginInstance<C> = { manifest, state: 'registered', create };
    this.instances.set(manifest.id, inst);
    this.log.info(`plugin registered: ${manifest.id}@${manifest.version}`);
    this.notify(manifest.id, 'registered');
    return () => {
      const i = this.instances.get(manifest.id);
      if (i && i.state === 'active') void this.deactivate(manifest.id);
      this.instances.delete(manifest.id);
    };
  }

  async activate(id: string, ctx: C): Promise<boolean> {
    const inst = this.instances.get(id);
    if (!inst) {
      this.log.warn(`activate unknown plugin: ${id}`);
      return false;
    }
    if (inst.state === 'active' || inst.state === 'activating') return true;
    this.setState(inst, 'activating');
    try {
      const plugin = inst.create();
      await plugin.activate(ctx);
      inst.plugin = plugin;
      this.setState(inst, 'active');
      this.log.info(`plugin activated: ${id}`);
      return true;
    } catch (e) {
      inst.error = e instanceof Error ? e.message : String(e);
      this.setState(inst, 'error');
      // 故障隔离：不向上抛，仅记录
      this.log.error(`plugin activation failed: ${id}`, inst.error);
      return false;
    }
  }

  async deactivate(id: string): Promise<void> {
    const inst = this.instances.get(id);
    if (!inst || inst.state !== 'active') return;
    this.setState(inst, 'deactivating');
    try {
      await inst.plugin?.deactivate();
    } catch (e) {
      this.log.error(`plugin deactivate error: ${id}`, e);
    }
    delete inst.plugin;
    inst.error = undefined;
    this.setState(inst, 'inactive');
    this.log.info(`plugin deactivated: ${id}`);
  }

  /** 拓扑排序激活（enabledIds + 其依赖） */
  async activateAll(ctx: C, enabledIds: string[]): Promise<void> {
    const enabled = new Set(enabledIds);
    const ordered = this.topoSort([...this.instances.values()]);
    for (const inst of ordered) {
      const needed = enabled.has(inst.manifest.id) || (inst.manifest.dependsOn ?? []).some((d) => enabled.has(d));
      if (needed) await this.activate(inst.manifest.id, ctx);
    }
  }

  get(id: string): PluginInstance<C> | undefined {
    return this.instances.get(id);
  }

  getState(id: string): PluginState {
    return this.instances.get(id)?.state ?? 'registered';
  }

  list(): PluginSummary[] {
    return [...this.instances.values()].map((i) => ({
      id: i.manifest.id,
      name: i.manifest.name,
      version: i.manifest.version,
      description: i.manifest.description,
      state: i.state,
      error: i.error,
    }));
  }

  onStateChange(fn: StateListener<C>): Disposer {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  private setState(inst: PluginInstance<C>, state: PluginState): void {
    inst.state = state;
    this.notify(inst.manifest.id, state);
  }

  private notify(id: string, state: PluginState): void {
    const inst = this.instances.get(id);
    if (!inst) return;
    const snapshot = inst;
    for (const fn of [...this.stateListeners]) fn(id, state, snapshot);
  }

  private topoSort(items: PluginInstance<C>[]): PluginInstance<C>[] {
    const out: PluginInstance<C>[] = [];
    const byId = new Map(items.map((i) => [i.manifest.id, i]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) return; // 环保护
      visiting.add(id);
      const inst = byId.get(id);
      if (inst) for (const dep of inst.manifest.dependsOn ?? []) visit(dep);
      visiting.delete(id);
      visited.add(id);
      if (inst) out.push(inst);
    };
    for (const i of items) visit(i.manifest.id);
    return out;
  }
}