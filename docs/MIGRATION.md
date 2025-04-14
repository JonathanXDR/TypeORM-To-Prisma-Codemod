# TypeORM to Prisma Migration Guide for NestJS

This guide accompanies the codemod tool to help you migrate from TypeORM to Prisma in a NestJS application, based on the official Prisma migration approach.

## Prerequisites

Before running the codemod, make sure you have:

1. Installed Prisma in your project:

   ```bash
   npm install prisma --save-dev
   npm install @prisma/client
   ```

2. Backed up your code or used version control to track changes

3. Installed jscodeshift:

   ```bash
   npm install -g jscodeshift
   ```

4. Working TypeORM project connected to a database

## Migration Steps

### 1. Prisma Setup and Database Introspection

First, initialize Prisma and connect it to your database:

```bash
# Initialize Prisma
npx prisma init

# Update DATABASE_URL in .env file with your connection string
# Then introspect your database to create the Prisma schema
npx prisma db pull
```

The `db pull` command will create a `schema.prisma` file that reflects your database structure.

### 2. Create a baseline migration

Create and apply a baseline migration to mark the current state of your database:

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > baseline.sql
npx prisma migrate resolve --applied "baseline"
```

### 3. Generate Prisma Client

Generate the Prisma client based on your schema:

```bash
npx prisma generate
```

### 4. Setup Prisma in your NestJS application

Create the Prisma service and module files provided in the `prisma-module-implementation.ts` artifact:

- Create a file at `src/prisma/prisma.service.ts`
- Create a file at `src/prisma/prisma.module.ts`

### 5. Run the Codemod

Save the codemod script as `typeorm-to-prisma.js` and run:

```bash
npx jscodeshift -t typeorm-to-prisma.js --extensions=ts --parser=ts path/to/your/src
```

This will automatically transform your TypeORM repository usage to Prisma Client queries.

### 6. Manual Adjustments and Common Query Conversions

The codemod can't handle every scenario. Here are the most common TypeORM to Prisma query conversions and areas that need manual attention:

#### Basic CRUD Operations

```typescript
// FIND OPERATIONS
// TypeORM: Find one by ID
const user = await userRepository.findOne({ where: { id: 1 } })
// Prisma: Find one by ID
const user = await prisma.user.findUnique({ where: { id: 1 } })

// TypeORM: Find with conditions
const users = await userRepository.find({
  where: { isActive: true },
  skip: 10,
  take: 5,
  order: { createdAt: 'DESC' },
})
// Prisma: Find with conditions
const users = await prisma.user.findMany({
  where: { isActive: true },
  skip: 10,
  take: 5,
  orderBy: { createdAt: 'desc' },
})

// CREATE OPERATIONS
// TypeORM: Create
const user = await userRepository.save({
  email: 'alice@prisma.io',
  name: 'Alice',
})
// Prisma: Create
const user = await prisma.user.create({
  data: {
    email: 'alice@prisma.io',
    name: 'Alice',
  },
})

// UPDATE OPERATIONS
// TypeORM: Update by ID
await userRepository.update(1, { name: 'New name' })
// Prisma: Update by ID
await prisma.user.update({
  where: { id: 1 },
  data: { name: 'New name' },
})

// DELETE OPERATIONS
// TypeORM: Delete
await userRepository.delete(1)
// Prisma: Delete
await prisma.user.delete({
  where: { id: 1 },
})
```

#### Relationships and Includes

```typescript
// TypeORM: Eager loading with relations
const user = await userRepository.findOne({
  where: { id: 1 },
  relations: ['posts', 'profile'],
})

// Prisma: Eager loading with include
const user = await prisma.user.findUnique({
  where: { id: 1 },
  include: {
    posts: true,
    profile: true,
  },
})

// TypeORM: Nested relations
const user = await userRepository.findOne({
  where: { id: 1 },
  relations: ['posts', 'posts.comments'],
})

// Prisma: Nested includes
const user = await prisma.user.findUnique({
  where: { id: 1 },
  include: {
    posts: {
      include: {
        comments: true,
      },
    },
  },
})
```

#### Query Builder Transformations

TypeORM query builders need to be replaced with Prisma client queries:

```typescript
// TypeORM
const users = await this.userRepository
  .createQueryBuilder('user')
  .leftJoinAndSelect('user.profile', 'profile')
  .where('user.isActive = :isActive', { isActive: true })
  .getMany()

// Prisma
const users = await this.prisma.user.findMany({
  where: {
    isActive: true,
  },
  include: {
    profile: true,
  },
})
```

#### Transaction Handling

Replace TypeORM transactions:

```typescript
// TypeORM
await this.connection.transaction(async (manager) => {
  await manager.save(user)
  await manager.save(profile)
})

// Prisma
await this.prisma.$transaction(async (tx) => {
  await tx.user.create({ data: user })
  await tx.profile.create({ data: profile })
})
```

#### Custom Repositories

Prisma doesn't have a direct equivalent of TypeORM custom repositories. Consider:

1. Moving repository logic to services
2. Creating facade services that encapsulate Prisma client operations
3. Using Prisma's extension API to add custom methods

```typescript
// Example of a service-based approach
@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async findActiveUsers() {
    return this.prisma.user.findMany({
      where: { isActive: true },
    })
  }

  async deactivateUser(id: number) {
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    })
  }
}
```

### 6. Testing

Thoroughly test all database operations after migration, particularly:

- CRUD operations
- Relationships and eager loading
- Transactions
- Custom queries

## Common Challenges and Solutions

### 1. Schema Management Approach

**Challenge**: TypeORM and Prisma have different approaches to schema definition and migration.

**Solution**: Use Prisma's introspection (`prisma db pull`) to generate your schema from the existing database, then use Prisma Migrate for future changes with `prisma migrate dev`.

### 2. Soft Deletes

**Challenge**: TypeORM has built-in soft delete, but Prisma handles it differently.

**Solution**: Implement Prisma middleware for soft deletes:

```typescript
// In prisma.service.ts
constructor() {
  super({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

  // Add middleware for soft deletes
  this.$use(async (params, next) => {
    // Check if this is a findUnique/findMany/findFirst query
    if (params.action === 'findUnique' || params.action === 'findFirst') {
      // Add deletedAt filter
      params.args.where = {
        ...params.args.where,
        deletedAt: null,
      };
    }
    if (params.action === 'findMany') {
      // Add deletedAt filter
      if (params.args.where) {
        params.args.where = {
          ...params.args.where,
          deletedAt: null,
        };
      } else {
        params.args.where = { deletedAt: null };
      }
    }
    return next(params);
  });
}

// Helper for soft delete
async softDelete<T extends { id: number | string }>(
  model: string,
  id: number | string
): Promise<T> {
  const modelRef = this[model] as any;
  return modelRef.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });
}
```

### 3. Complex Filters and Raw Queries

**Challenge**: Prisma may not support some complex SQL queries directly.

**Solution**: Use Prisma's `$queryRaw` for complex SQL when needed:

```typescript
// Complex query in TypeORM with Query Builder
const result = await connection
  .getRepository(User)
  .createQueryBuilder('user')
  .select('COUNT(DISTINCT user.email)', 'count')
  .where('user.createdAt > :date', { date: new Date('2020-01-01') })
  .getRawOne()

// Equivalent in Prisma
const result = await prisma.$queryRaw`
  SELECT COUNT(DISTINCT "email") as "count" 
  FROM "User" 
  WHERE "createdAt" > ${new Date('2020-01-01')}
`
```

### 4. Enum Handling

**Challenge**: TypeORM can use TypeScript enums directly, Prisma requires schema definition.

**Solution**: Define enums in the Prisma schema and use the generated enum types.

### 5. Subscription and Listeners

**Challenge**: TypeORM entity listeners/subscribers don't have direct equivalents in Prisma.

**Solution**: Use Prisma middleware and service-layer hooks:

```typescript
// In prisma.service.ts
this.$use(async (params, next) => {
  // Before hook
  if (params.action === 'create' && params.model === 'User') {
    // Do something before user creation
  }

  // Execute the query
  const result = await next(params)

  // After hook
  if (params.action === 'create' && params.model === 'User') {
    // Do something after user creation
    await this.eventEmitter.emit('user.created', result)
  }

  return result
})
```

## Best Practices After Migration

1. **Use Prisma's strengths**: Take advantage of Prisma's strong typing and auto-completion
2. **Consider Prisma Extensions**: For complex queries or repeated patterns
3. **Leverage Middleware**: For cross-cutting concerns like soft deletes or audit logging
4. **Keep Schema in Sync**: Use Prisma Migrate for schema changes
5. **Test Thoroughly**: Database migrations are high-risk; test all data access patterns
6. **Use Prisma Studio**: Leverage `npx prisma studio` for database visualization and management
7. **Streamline Testing**: Use Prisma's testing utilities for database tests

## Testing Your Migration

After running the codemod, thoroughly test your application:

1. **Unit Tests**: Update your unit tests to use Prisma instead of TypeORM
2. **Integration Tests**: Ensure all API endpoints work correctly with the new data layer
3. **Performance Tests**: Compare query performance before and after migration

Use this testing script for validating your routes:

```bash
# Example test script for API endpoints
for endpoint in users posts comments; do
  echo "Testing $endpoint endpoint..."
  curl -s http://localhost:3000/$endpoint | jq
done
```

## Gradual Migration Strategy

For large applications, consider a gradual migration approach:

1. Start with non-critical features or modules
2. Run both TypeORM and Prisma side by side during transition
3. Create abstraction layers that can work with both ORMs
4. Migrate one repository at a time
5. Add extensive logging during the transition period

## Resources

- [Prisma Documentation](https://www.prisma.io/docs/orm)
- [Prisma with NestJS](https://docs.nestjs.com/recipes/prisma)
- [Prisma Migrate Guide](https://www.prisma.io/docs/orm/prisma-migrate)
- [Prisma Data Guide](https://www.prisma.io/dataguide)
- [TypeORM to Prisma Comparison](https://www.prisma.io/docs/orm/more/comparisons/prisma-and-typeorm)
