# typeorm-cursor-connection

Relay Cursor Connection implementations for TypeORM

[![npm version](https://badge.fury.io/js/typeorm-cursor-connection.svg)](https://badge.fury.io/js/typeorm-cursor-connection)
[![Build Status](https://travis-ci.org/hanpama/typeorm-cursor-connection.svg?branch=master)](https://travis-ci.org/hanpama/typeorm-cursor-connection)
[![codecov](https://codecov.io/gh/hanpama/typeorm-cursor-connection/branch/master/graph/badge.svg)](https://codecov.io/gh/hanpama/typeorm-cursor-connection)


## EntityConnection

Connection for querying multiple entities from `Repository`.

```ts
export interface EntityConnectionOptions<TEntity> {
    sortOptions: EntityConnectionSortOption[];
    repository: Repository<TEntity>;
    where?: (qb: SelectQueryBuilder<TEntity>) => any;
}

export declare class EntityConnection<TEntity extends Object> extends Connection<TEntity, TEntity> {
    constructor(args: ConnectionArguments, options: EntityConnectionOptions<TEntity>);
}
```

## MongoEntityConnection

Connection for querying multiple entities from `MongoRepository`.

```ts
export interface MongoEntityConnectionOptions<Entity> {
    sortOptions: { [fieldName: string]: 1 | -1; };
    repository: MongoRepository<Entity>;
    selector?: Selector;
}
export declare class MongoEntityConnection<Entity extends Object> extends Connection<Entity, Entity> {
    constructor(args: ConnectionArguments, options: MongoEntityConnectionOptions<Entity>);
}
```

## How it works

A cursor is serialized data representing the position of the node in the connection.
`EntityConnection` and `MongoEntityConnection` serialize the values of field, which is used for sorting, into the cursor.

```ts
@Entity()
class Post {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column()
  createdAt: Date;
};
```

Let's suppose we have a table of `Post`s.

```
{ id: 1, title: 'Post A', createdAt: new Date('2018-03-02') }
{ id: 2, title: 'Post C', createdAt: new Date('2018-03-03') }
{ id: 3, title: 'Post D', createdAt: new Date('2018-03-04') }
{ id: 4, title: 'Post B', createdAt: new Date('2018-03-05') }
```

And we are querying the entities in the order we want.

```ts
const postConnectionOrderedByTitle = new EntityConnection({
  sortOptions: [
    { sort: 'title', order: 'ASC' },
  ],
  repository: getRepository(Post),
})
/*
                cursor
                --------
{ id: 1, title: 'Post A', createdAt: new Date('2018-03-02') }, -> cursor: ['Post A']
{ id: 4, title: 'Post B', createdAt: new Date('2018-03-05') }, -> cursor: ['Post B']
{ id: 2, title: 'Post C', createdAt: new Date('2018-03-03') }, -> cursor: ['Post C']
{ id: 3, title: 'Post D', createdAt: new Date('2018-03-04') }, -> cursor: ['Post D']
*/
```

Cursors are for making a new query after the place of the node,
so we can use `title` field as the cursor for that connection.
With the cursor, We can query `Post`s where `Post`'s title is greater than the cursor.

But it can go wrong when not all `title` value is unique in the table.
So we take the approach of keeping cursor value is unique in the connection.

In order to do that:

```ts
const postConnectionOrderedByTitle = new EntityConnection({
  sortOptions: [
    { sort: 'title', order: 'ASC' },
    { sort: 'id', order: 'ASC' }
  ],
  repository: getRepository(Post),
})
/*
     cursor[1]   cursor[0]
     --          --------
{ id: 1, title: 'Post A', createdAt: new Date('2018-03-02') }, -> cursor: ['Post A', 1]
{ id: 4, title: 'Post B', createdAt: new Date('2018-03-05') }, -> cursor: ['Post B', 4]
{ id: 2, title: 'Post C', createdAt: new Date('2018-03-03') }, -> cursor: ['Post C', 2]
{ id: 3, title: 'Post D', createdAt: new Date('2018-03-04') }, -> cursor: ['Post D', 3]
*/
```

We have the `id` field included to cursor, and it guarantees every cursor value is unique even when
new `Post`s are inserted to the table.
