import type { OpportunityRecord, PositionSnapshot } from "../domain/types";

export interface IOpportunityRepository {
  save(record: OpportunityRecord): void;
  findById(id: string): OpportunityRecord | undefined;
  findAll(): OpportunityRecord[];
  findRecent(limit: number): OpportunityRecord[];
}

export interface IPositionRepository {
  save(snapshot: PositionSnapshot): void;
  findById(positionId: string): PositionSnapshot[];
  findLatest(positionId: string): PositionSnapshot | undefined;
}

export class InMemoryOpportunityRepository implements IOpportunityRepository {
  private store = new Map<string, OpportunityRecord>();

  save(record: OpportunityRecord): void {
    this.store.set(record.id, record);
  }

  findById(id: string): OpportunityRecord | undefined {
    return this.store.get(id);
  }

  findAll(): OpportunityRecord[] {
    return Array.from(this.store.values());
  }

  findRecent(limit: number): OpportunityRecord[] {
    return Array.from(this.store.values())
      .sort((a, b) => b.discoveredAtUtc - a.discoveredAtUtc)
      .slice(0, limit);
  }
}

export class InMemoryPositionRepository implements IPositionRepository {
  private store = new Map<string, PositionSnapshot[]>();

  save(snapshot: PositionSnapshot): void {
    const list = this.store.get(snapshot.positionId) ?? [];
    list.push(snapshot);
    this.store.set(snapshot.positionId, list);
  }

  findById(positionId: string): PositionSnapshot[] {
    return this.store.get(positionId) ?? [];
  }

  findLatest(positionId: string): PositionSnapshot | undefined {
    const list = this.findById(positionId);
    return list.length > 0 ? list[list.length - 1] : undefined;
  }
}

export const repositories = {
  opportunities: new InMemoryOpportunityRepository(),
  positions: new InMemoryPositionRepository(),
};
