import { Connection, ConnectionArguments, Edge } from '@girin/connection';
import { MongoRepository } from 'typeorm';


export interface MongoEntityConnectionSortOption {
  fieldName: string;
  order: 1 | -1;
}

export interface Selector { [fieldName: string]: any; }

export interface MongoEntityConnectionOptions<Entity> {
  sortOptions: { [fieldName: string]: 1 | -1 };
  repository: MongoRepository<Entity>;
  selector?: Selector;
}

export class MongoEntityConnection<Entity extends Object> extends Connection<Entity, Entity> {

  protected limit?: number;
  protected sortOptions: MongoEntityConnectionSortOption[];
  protected afterKey?: any[];
  protected beforeKey?: any[];
  protected afterSelector?: Selector;
  protected beforeSelector?: Selector;
  protected selector: Selector;

  protected bson: any;

  constructor(args: ConnectionArguments, public options: MongoEntityConnectionOptions<Entity>) {
    super(args);
    this.bson = require('mongodb/lib/bulk/common').bson;

    if (args.first && args.last) {
      throw new Error('Argument "first" and "last" must not be included at the same time');
    }
    this.sortOptions = Object.keys(options.sortOptions)
      .map(fieldName => ({ fieldName, order: options.sortOptions[fieldName] }));

    if (typeof args.first !== 'number' && typeof args.last !== 'number') {
      this.args = { ...args };
    }

    this.limit = args.first || args.last || undefined;

    const selectors: Selector[] = [];
    if (args.after) {
      this.afterKey = this.explodeCursor(args.after);
      this.afterSelector = this.keyToSelector(this.afterKey, 'after');
      selectors.push(this.afterSelector);
    }
    if (args.before) {
      this.beforeKey = this.explodeCursor(args.before);
      this.beforeSelector = this.keyToSelector(this.beforeKey, 'before');
      selectors.push(this.beforeSelector);
    }
    if (options.selector) {
      selectors.push(options.selector);
    }
    if (selectors.length === 0) {
      this.selector = {};
    } else if (selectors.length === 1) {
      this.selector = selectors[0];
    } else {
      this.selector = { $and: selectors };
    }
  }

  public edges: Promise<Edge<MongoEntityConnection<Entity>>[]>;

  resolveCursor(item: Entity): string {
    const key = this.sortOptions.map(({ fieldName }) => item[fieldName as keyof Entity]);
    return this.bson.serialize(key).toString('base64');
  }

  resolveNode(item: Entity): Entity {
    return item;
  }

  async resolveHasNextPage() {
    const { first, before } = this.args;
    const { repository } = this.options;

    if (typeof first === 'number') {
      const limitOrMore = await repository.count(this.selector, { limit: first + 1 });
      return limitOrMore > first;
    }
    if (typeof before === 'string') {
      const afterBeforeSelector = this.keyToSelector(this.beforeKey!, 'after');
      const oneOrZero = await repository.count(afterBeforeSelector, { limit: 1 });
      return oneOrZero > 0;
    }
    return false;
  }

  async resolveHasPreviousPage() {
    const { last, after } = this.args;
    const { repository } = this.options;

    if (typeof last === 'number') {
      const limitOrMore = await repository.count(this.selector, { limit: last + 1 });
      return limitOrMore > last;
    }
    if (typeof after === 'string') {
      const beforeAfterSelector = this.keyToSelector(this.afterKey!, 'before');
      const oneOrZero = await repository.count(beforeAfterSelector, { limit: 1 });
      return oneOrZero > 0;
    }
    return false;
  }

  getEdgeSources(): Promise<Entity[]> {
    if (!this.queryPromise) {
      this.queryPromise = this.query();
    }
    return this.queryPromise;
  }

  async query(): Promise<Entity[]> {
    const { repository } = this.options;

    const reverse = typeof this.args.last === 'number';
    const appliedSortOrder = this.sortOptions.reduce((results, { fieldName, order }) => {
      results[fieldName] = order * (reverse ? -1 : 1);
      return results;
    }, {} as any);

    const docs = await repository
      .find({
        where: this.selector,
        order: appliedSortOrder,
        take: this.limit,
      });

    if (reverse) { docs.reverse(); }
    return docs;
  }

  protected queryPromise: Promise<Entity[]> | null = null;

  protected explodeCursor(cursor: string): any[] {
    const buffer = Buffer.from(cursor, 'base64');
    return this.bson.deserialize(buffer);
  }

  protected keyToSelector(key: any, direction: 'after' | 'before') {
    const eq = direction === 'after'
      ? ['$gt', '$lt', '$gte', '$lte']
      : ['$lt', '$gt', '$lte', '$gte'];
    const { sortOptions } = this;
    const $or: any = [];

    for (let i = 0; i < sortOptions.length; i++) {
      const selector: any = {};
      for (let j = 0; j < i + 1; j++) {
        const { fieldName, order } = sortOptions[j];
        const value = key[j];

        let equality: string;
        if (i === j) {
          equality = order === 1 ? eq[0] : eq[1];
        } else {
          equality = order === 1 ? eq[2] : eq[3];
        }

        selector[fieldName] = { [equality]: value };
      }
      $or.push(selector);
    }
    return { $or };
  }
}
