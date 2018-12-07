import 'reflect-metadata';
import { ConnectionArguments } from '@girin/connection';
import { Connection, Column, Entity, PrimaryColumn, Generated } from 'typeorm';

import { createTestingConnections, closeTestingConnections, reloadTestingDatabases } from './testenv';
import { EntityConnection } from '../src';


@Entity('EntityConnection-test')
class Post {

  @PrimaryColumn('integer')
  @Generated()
  id: number;

  @Column()
  slug: string;

  @Column()
  category: string;

  @Column()
  createdAt: Date;
}


function loadPosts(connection: Connection) {
  const posts: Post[] = [];
  for (let i = 1; i <= 50; i++) {
    const post = new Post();
    post.category = i % 2 ? 'Foo' : 'Bar';
    post.slug = `post${i}`;
    post.createdAt = new Date(1990 + i, 5, 5);
    posts.push(post);
  }
  return connection.getRepository(Post).createQueryBuilder().insert().values(posts).execute();
}

describe('index connection', () => {

  let connections: Connection[];

  beforeAll(async () => {
    connections = await createTestingConnections({
      enabledDrivers: [
        'mysql',
        'mariadb',
        'sqlite',
        'postgres'
      ],
      entities: [Post],
    });
  });
  beforeEach(() => reloadTestingDatabases(connections));
  afterAll(() => closeTestingConnections(connections));


  function queryPostsOrderedById(dbConn: Connection, args: ConnectionArguments) {
    const connection = new EntityConnection(args, {
      repository: dbConn.getRepository(Post),
      sortOptions: [
        { sort: 'id', order: 'ASC' },
        { sort: 'slug', order: 'ASC' },
      ],
    });
    return connection;
  }

  function queryPostsOrderedByCategoryAndCreatedAt(
    dbConn: Connection,
    args: ConnectionArguments,
    category: string,
  ) {
    return new EntityConnection(args, {
      repository: dbConn.getRepository(Post),
      sortOptions: [
        { sort: 'id', order: 'ASC' },
      ],
      where: qb => qb.where('category = :category', { category }),
    });
  }

  it('implements relay cursor connection spec', () => Promise.all(
    connections.map(async dbConn => {
      await loadPosts(dbConn);

      // post1 ~ 10
      let connection = queryPostsOrderedById(dbConn, { first: 10 });
      let edges = await connection.edges;
      let pageInfo = connection.pageInfo;
      expect(edges).toHaveLength(10);
      expect(edges[0].node.slug).toBe('post1');
      expect(edges[9].node.slug).toBe('post10');
      expect(await pageInfo.hasPreviousPage).toBe(false);
      expect(await pageInfo.hasNextPage).toBe(true);

      // pick 10
      const lastEdge = edges[edges.length - 1];

      // query after 10 should be 11 ~ 20
      connection = queryPostsOrderedById(dbConn, { first: 10, after: lastEdge.cursor });
      edges = await connection.edges;
      pageInfo = connection.pageInfo;
      expect(edges).toHaveLength(10);
      expect(edges[0].node.slug).toBe('post11');
      expect(edges[9].node.slug).toBe('post20');
      expect(await pageInfo.hasPreviousPage).toBe(true);
      expect(await pageInfo.hasNextPage).toBe(true);

      // take 11, 16 and get items between them
      const start = edges[0];
      const end = edges[5];
      connection = queryPostsOrderedById(dbConn, {
        first: 10,
        after: start.cursor,
        before: end.cursor,
      });
      edges = await connection.edges;
      pageInfo = connection.pageInfo;

      expect(edges).toHaveLength(4);
      expect(await pageInfo.hasPreviousPage).toBe(true);
      expect(await pageInfo.hasNextPage).toBe(false);
      expect(edges[0].node.slug).toBe('post12');
      expect(edges[3].node.slug).toBe('post15');

      // first 2 items after 11 before 16 should be post12 and post13
      connection = queryPostsOrderedById(dbConn, {
        first: 2,
        after: start.cursor,
        before: end.cursor,
      });
      edges = await connection.edges;
      pageInfo = connection.pageInfo;

      expect(edges).toHaveLength(2);
      expect(edges[0].node.slug).toBe('post12');
      expect(await pageInfo.hasPreviousPage).toBe(true);
      expect(await pageInfo.hasNextPage).toBe(true);

      // last 2 items after 11 before 16 should be post14 and post15
      connection = queryPostsOrderedById(dbConn, {
        after: start.cursor,
        before: end.cursor,
        last: 2,
      });
      edges = await connection.edges;
      pageInfo = connection.pageInfo;
      expect(edges).toHaveLength(2);
      expect(edges[0].node.slug).toBe('post14');
      expect(edges[1].node.slug).toBe('post15');
      expect(await pageInfo.hasPreviousPage).toBe(true);
      expect(await pageInfo.hasNextPage).toBe(true);

      // last + first (error)
      expect(() => queryPostsOrderedById(dbConn, { last: 2, first: 2 })).toThrowError(
        'Argument "first" and "last" must not be included at the same time'
      );

      // last
      connection = queryPostsOrderedById(dbConn, { last: 5 });
      edges = await connection.edges;
      pageInfo = connection.pageInfo;

      expect(edges).toHaveLength(5);
      expect(edges[4].node.slug).toBe('post50');
      expect(edges[3].node.slug).toBe('post49');
      expect(await pageInfo.hasPreviousPage).toBe(true);
      expect(await pageInfo.hasNextPage).toBe(false);
    })
  ));

  it('works with custom where predicates', () => Promise.all(
    connections.map(async dbConn => {

      await loadPosts(dbConn);
      // 1 ~ 10
      let connection = queryPostsOrderedByCategoryAndCreatedAt(dbConn, { first: 10 }, 'Foo');
      let edges = await connection.edges;
      let pageInfo = connection.pageInfo;

      expect(edges).toHaveLength(10);
      expect(edges[0].node.slug).toBe('post1');
      expect(edges[1].node.slug).toBe('post3');
      expect(edges[9].node.slug).toBe('post19');
      expect(await pageInfo.hasPreviousPage).toBe(false);
      expect(await pageInfo.hasNextPage).toBe(true);

      // distinct category set
      const categorySet = edges.reduce((res, edge) => {
        res[edge.node.category] = true;
        return res;
      }, {} as any);
      expect(categorySet).toEqual({ Foo: true });

      // pick 10th
      const lastEdge = edges[edges.length - 1];

      // query after 10 should be 11 ~ 20
      connection = queryPostsOrderedByCategoryAndCreatedAt(dbConn, { first: 10, after: lastEdge.cursor }, 'Foo');
      edges = await connection.edges;
      pageInfo = connection.pageInfo;

      expect(edges).toHaveLength(10);
      expect(edges[0].node.slug).toBe('post21');
      expect(edges[1].node.slug).toBe('post23');
      expect(edges[9].node.slug).toBe('post39');
      expect(await pageInfo.hasPreviousPage).toBe(true);
      expect(await pageInfo.hasNextPage).toBe(true);

      // take 11, 16 and get items between them
      const start = edges[0];
      const end = edges[5];
      connection = queryPostsOrderedByCategoryAndCreatedAt(
        dbConn,
        { first: 10, after: start.cursor, before: end.cursor },
        'Foo',
      );
      edges = await connection.edges;
      pageInfo = connection.pageInfo;

      expect(edges).toHaveLength(4);
      expect(edges[0].node.slug).toBe('post23');
      expect(edges[3].node.slug).toBe('post29');
      expect(await pageInfo.hasPreviousPage).toBe(true);
      expect(await pageInfo.hasNextPage).toBe(false);

      // first 2 items after 11 before 16 should be post12 and post13
      connection = queryPostsOrderedByCategoryAndCreatedAt(
        dbConn,
        { first: 2, after: start.cursor, before: end.cursor },
        'Foo',
      );
      edges = await connection.edges;
      pageInfo = connection.pageInfo;
      expect(edges).toHaveLength(2);
      expect(edges[0].node.slug).toBe('post23');
      expect(edges[1].node.slug).toBe('post25');
      expect(await pageInfo.hasPreviousPage).toBe(true);
      expect(await pageInfo.hasNextPage).toBe(true);

      // last 2 items after 11 before 16 should be post12 and post13
      connection =  queryPostsOrderedByCategoryAndCreatedAt(
        dbConn,
        { last: 2, after: start.cursor, before: end.cursor },
        'Foo',
      );
      edges = await connection.edges;
      pageInfo = connection.pageInfo;
      expect(edges).toHaveLength(2);
      expect(edges[0].node.slug).toBe('post27');
      expect(edges[1].node.slug).toBe('post29');
      expect(await pageInfo.hasPreviousPage).toBe(true);
      expect(await pageInfo.hasNextPage).toBe(true);

      // in case of category Bar, it should work fine
      connection = queryPostsOrderedByCategoryAndCreatedAt(dbConn, { first: 10 }, 'Bar');
      edges = await connection.edges;
      pageInfo = connection.pageInfo;
      expect(edges).toHaveLength(10);
      expect(edges[0].node.slug).toBe('post2');
      expect(edges[1].node.slug).toBe('post4');
      expect(edges[2].node.slug).toBe('post6');
      expect(edges.map(edge => edge.node.category)).not.toContain('Foo');

      // no items with category Baz
      connection = queryPostsOrderedByCategoryAndCreatedAt(dbConn, { first: 10 }, 'Baz');
      edges = await connection.edges;
      expect(edges).toHaveLength(0);
    }),
  ));

});
