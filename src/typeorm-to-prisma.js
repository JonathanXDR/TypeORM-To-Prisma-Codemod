/**
 * TypeORM to Prisma Migration Codemod
 *
 * This codemod helps migrate a Nest.js application from TypeORM to Prisma.
 * It transforms repository usages and query operations to their Prisma equivalents.
 *
 * This follows the official Prisma migration approach with the addition of automated code transformation.
 *
 * Usage:
 * npx jscodeshift -t typeorm-to-prisma.js --extensions=ts --parser=ts path/to/your/src
 *
 * Note: This codemod handles common patterns but manual adjustments might be needed for complex cases.
 *
 * Important: Before running this codemod, you should:
 * 1. Install Prisma CLI: npm install prisma --save-dev
 * 2. Initialize Prisma: npx prisma init
 * 3. Introspect your database: npx prisma db pull
 * 4. Install Prisma Client: npm install @prisma/client
 * 5. Generate Prisma Client: npx prisma generate
 */

const typeormToPrismaTypeMap = {
  // TypeORM to Prisma type mappings
  string: 'String',
  number: 'Int',
  boolean: 'Boolean',
  Date: 'DateTime',
  json: 'Json',
  varchar: 'String',
  text: 'String',
  int: 'Int',
  integer: 'Int',
  smallint: 'Int',
  bigint: 'BigInt',
  float: 'Float',
  double: 'Float',
  decimal: 'Decimal',
  boolean: 'Boolean',
  date: 'DateTime',
  datetime: 'DateTime',
  timestamp: 'DateTime',
  enum: 'Enum',
  json: 'Json',
  jsonb: 'Json',
  uuid: 'String',
  'simple-array': 'String[]',
  'simple-json': 'Json',
}

// Map of TypeORM decorators to corresponding Prisma schema features
const decoratorMap = {
  PrimaryGeneratedColumn: 'id',
  PrimaryColumn: 'id',
  Column: 'field',
  CreateDateColumn: 'createdAt',
  UpdateDateColumn: 'updatedAt',
  DeleteDateColumn: 'deletedAt',
  OneToOne: 'relation',
  ManyToOne: 'relation',
  OneToMany: 'relation',
  ManyToMany: 'relation',
  JoinColumn: 'join',
  JoinTable: 'join',
}

module.exports = function (fileInfo, api, options) {
  const j = api.jscodeshift
  const root = j(fileInfo.source)
  const fileChanged = {
    entities: false,
    repositories: false,
    modules: false,
    services: false,
  }

  // Track generated Prisma schema parts to be assembled later
  const prismaSchemaFragments = []
  const prismaEnums = new Set()
  const prismaModels = new Map()

  // Note: This function is kept for reference, but in a real migration process
  // you should use `npx prisma db pull` to introspect your database instead.
  // This function can help you understand how TypeORM entities map to Prisma models.
  function transformEntityClasses() {
    // Add a comment to indicate entity transformation is informational only
    console.log(
      'NOTE: Entity transformation is provided for reference only.\n' +
        'For a production migration, use `npx prisma db pull` to introspect your database\n' +
        'and generate an accurate Prisma schema.'
    )

    // Find all classes with @Entity decorator
    root.find(j.ClassDeclaration).forEach((path) => {
      const classNode = path.node
      const className = classNode.id.name

      // Check if this is an entity class (has @Entity decorator)
      let isEntity = false
      let entityOptions = {}

      // Find the Entity decorator if it exists
      j(path)
        .find(j.Decorator)
        .forEach((decoratorPath) => {
          const decorator = decoratorPath.node
          if (
            decorator.expression.type === 'CallExpression' &&
            decorator.expression.callee.name === 'Entity'
          ) {
            isEntity = true
            // Extract entity options like table name
            if (decorator.expression.arguments.length > 0) {
              // Assuming first argument might be table name or options object
              const arg = decorator.expression.arguments[0]
              if (arg.type === 'StringLiteral') {
                entityOptions.name = arg.value
              } else if (arg.type === 'ObjectExpression') {
                arg.properties.forEach((prop) => {
                  if (prop.key.name === 'name') {
                    entityOptions.name = prop.value.value
                  }
                })
              }
            }
          }
        })

      if (!isEntity) return

      // Start building the Prisma model definition
      let modelName = className
      let tableName = entityOptions.name || className.toLowerCase()

      let modelDefinition = `model ${modelName} {\n`

      // Process all class properties to find decorated fields
      j(path)
        .find(j.ClassProperty)
        .forEach((propPath) => {
          const property = propPath.node
          const propertyName = property.key.name

          // Skip properties without decorators
          if (!property.decorators || property.decorators.length === 0) return

          // Analyze each decorator on this property
          property.decorators.forEach((decorator) => {
            if (decorator.expression.type !== 'CallExpression') return

            const decoratorName = decorator.expression.callee.name
            const decoratorArgs = decorator.expression.arguments

            // Handle different TypeORM decorators
            switch (decoratorName) {
              case 'PrimaryGeneratedColumn':
                // Handle ID column
                let idType = 'Int'
                let idOptions = ''

                if (decoratorArgs.length > 0) {
                  // Get ID type (uuid, increment, etc.)
                  const firstArg = decoratorArgs[0]
                  if (firstArg.type === 'StringLiteral') {
                    if (firstArg.value === 'uuid') {
                      idType = 'String'
                      idOptions = '@id @default(uuid())'
                    } else if (firstArg.value === 'increment') {
                      idType = 'Int'
                      idOptions = '@id @default(autoincrement())'
                    }
                  }
                } else {
                  // Default to autoincrement integer
                  idOptions = '@id @default(autoincrement())'
                }

                modelDefinition += `  ${propertyName} ${idType} ${idOptions}\n`
                break

              case 'PrimaryColumn':
                // Handle primary column
                let primaryType = extractTypeFromProperty(property)
                modelDefinition += `  ${propertyName} ${primaryType} @id\n`
                break

              case 'Column':
                // Handle regular column
                let columnType = 'String'
                let columnOptions = []

                // Extract type and options from Column decorator
                if (decoratorArgs.length > 0) {
                  const typeArg = decoratorArgs[0]

                  // Type can be string or object config
                  if (typeArg.type === 'StringLiteral') {
                    columnType = mapTypeOrmTypeToPrisma(typeArg.value)
                  } else if (typeArg.type === 'ObjectExpression') {
                    // Handle column options object
                    typeArg.properties.forEach((prop) => {
                      switch (prop.key.name) {
                        case 'type':
                          if (prop.value.type === 'StringLiteral') {
                            columnType = mapTypeOrmTypeToPrisma(
                              prop.value.value
                            )
                          }
                          break
                        case 'nullable':
                          if (prop.value.value === true) {
                            columnOptions.push('?')
                          }
                          break
                        case 'default':
                          let defaultValue = ''
                          if (prop.value.type === 'StringLiteral') {
                            defaultValue = `"${prop.value.value}"`
                          } else if (
                            ['NumericLiteral', 'BooleanLiteral'].includes(
                              prop.value.type
                            )
                          ) {
                            defaultValue = prop.value.value
                          } else if (
                            prop.value.type === 'CallExpression' &&
                            prop.value.callee.name === 'Date'
                          ) {
                            defaultValue = 'now()'
                          }

                          if (defaultValue) {
                            columnOptions.push(`@default(${defaultValue})`)
                          }
                          break
                        case 'unique':
                          if (prop.value.value === true) {
                            columnOptions.push('@unique')
                          }
                          break
                      }
                    })
                  }
                } else {
                  // Infer type from TypeScript type annotation if present
                  columnType = extractTypeFromProperty(property)
                }

                // Build the field definition
                modelDefinition += `  ${propertyName} ${columnType}${
                  columnOptions.length ? ' ' + columnOptions.join(' ') : ''
                }\n`
                break

              case 'CreateDateColumn':
                modelDefinition += `  ${propertyName} DateTime @default(now())\n`
                break

              case 'UpdateDateColumn':
                modelDefinition += `  ${propertyName} DateTime @updatedAt\n`
                break

              case 'DeleteDateColumn':
                modelDefinition += `  ${propertyName} DateTime? @map("deleted_at")\n`
                break

              case 'OneToOne':
              case 'ManyToOne':
              case 'OneToMany':
              case 'ManyToMany':
                // Extract relation target type
                let targetType = ''
                let fieldName = propertyName

                if (decoratorArgs.length > 0) {
                  // First argument is often a function returning the target type
                  // E.g., () => User or type => User
                  const firstArg = decoratorArgs[0]

                  if (
                    firstArg.type === 'ArrowFunctionExpression' &&
                    firstArg.body.type === 'Identifier'
                  ) {
                    targetType = firstArg.body.name
                  }
                } else if (property.typeAnnotation) {
                  // Try to extract from type annotation
                  const typeAnnotation = property.typeAnnotation.typeAnnotation
                  if (typeAnnotation.type === 'TSTypeReference') {
                    targetType = typeAnnotation.typeName.name
                  }
                }

                // If we couldn't determine target type, use a placeholder
                if (!targetType) {
                  targetType = 'Unknown'
                }

                // Handle different relation types
                switch (decoratorName) {
                  case 'OneToOne':
                    modelDefinition += `  ${fieldName} ${targetType}? @relation("${className}To${targetType}")\n`
                    break
                  case 'ManyToOne':
                    modelDefinition += `  ${fieldName} ${targetType} @relation("${fieldName}Relation")\n`
                    // Add the foreign key field
                    modelDefinition += `  ${fieldName}Id Int\n`
                    break
                  case 'OneToMany':
                    // This becomes the "many" side of a relation
                    // In Prisma, this is often represented by an array field
                    modelDefinition += `  ${fieldName} ${targetType}[] @relation("${fieldName}Relation")\n`
                    break
                  case 'ManyToMany':
                    // ManyToMany relations in Prisma often require explicit join tables
                    modelDefinition += `  ${fieldName} ${targetType}[] @relation("${className}To${targetType}")\n`
                    break
                }
                break
            }
          })
        })

      // Close model definition
      modelDefinition += `\n  @@map("${tableName}")\n}\n`

      // Store this model definition to be added to the schema later
      prismaModels.set(className, modelDefinition)

      // Add comment before the entity class to indicate it should be replaced
      j(path).insertBefore(
        j.commentLine(
          ' The TypeORM entity below should be replaced with the Prisma Client. Use the Prisma schema generated by `npx prisma db pull` instead.'
        )
      )

      // Mark file as changed
      fileChanged.entities = true
    })
  }

  // Helper function to map TypeORM types to Prisma types
  function mapTypeOrmTypeToPrisma(typeormType) {
    return typeormToPrismaTypeMap[typeormType.toLowerCase()] || 'String'
  }

  // Extract type from property TypeScript annotation
  function extractTypeFromProperty(property) {
    if (!property.typeAnnotation) return 'String'

    const typeAnnotation = property.typeAnnotation.typeAnnotation

    if (typeAnnotation.type === 'TSStringKeyword') {
      return 'String'
    } else if (typeAnnotation.type === 'TSNumberKeyword') {
      return 'Int'
    } else if (typeAnnotation.type === 'TSBooleanKeyword') {
      return 'Boolean'
    } else if (typeAnnotation.type === 'TSTypeReference') {
      const typeName = typeAnnotation.typeName.name

      // Map known TypeScript types to Prisma types
      switch (typeName) {
        case 'Date':
          return 'DateTime'
        case 'number':
          return 'Int'
        case 'string':
          return 'String'
        case 'boolean':
          return 'Boolean'
        default:
          return mapTypeOrmTypeToPrisma(typeName) || 'String'
      }
    }

    return 'String'
  }

  // Transform TypeORM repository usage to Prisma client usage
  function transformRepositoryUsage() {
    // Replace repository injection in constructors
    root.find(j.ClassDeclaration).forEach((classPath) => {
      // Find constructor
      j(classPath)
        .find(j.MethodDefinition, { kind: 'constructor' })
        .forEach((constructorPath) => {
          // Find repository parameter injections
          const params = constructorPath.node.value.params
          let hasRepositoryParam = false

          params.forEach((param, index) => {
            if (
              param.type === 'TSParameterProperty' &&
              param.parameter.type === 'Identifier' &&
              param.parameter.typeAnnotation &&
              param.parameter.typeAnnotation.typeAnnotation.type ===
                'TSTypeReference'
            ) {
              const typeRef = param.parameter.typeAnnotation.typeAnnotation
              const typeName = typeRef.typeName.name

              // Check if this is a Repository injection
              if (typeName === 'Repository') {
                hasRepositoryParam = true

                // Get the entity type from generic param
                let entityType = 'Unknown'
                if (
                  typeRef.typeParameters &&
                  typeRef.typeParameters.params &&
                  typeRef.typeParameters.params.length > 0
                ) {
                  const typeParam = typeRef.typeParameters.params[0]
                  if (typeParam.type === 'TSTypeReference') {
                    entityType = typeParam.typeName.name
                  }
                }

                // Replace repository parameter with prisma client parameter
                params[index] = j.identifier('private prisma')
                params[index].typeAnnotation = j.tsTypeAnnotation(
                  j.tsTypeReference(j.identifier('PrismaService'))
                )
              }
            }
          })

          if (hasRepositoryParam) {
            fileChanged.services = true
          }
        })
    })

    // Transform repository method calls to prisma client calls
    root.find(j.CallExpression).forEach((callPath) => {
      const call = callPath.node
      const callee = call.callee

      // Check if it's a method call on a repository
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'MemberExpression' &&
        callee.object.property.name === 'repository'
      ) {
        // Get repository method name and transform to Prisma equivalent
        const methodName = callee.property.name

        // Replace with corresponding Prisma client method
        switch (methodName) {
          case 'find':
            // this.repository.find() → this.prisma.model.findMany()
            callee.object = j.memberExpression(
              j.memberExpression(j.thisExpression(), j.identifier('prisma')),
              j.identifier(getModelNameFromContext(callPath) || 'model')
            )
            callee.property = j.identifier('findMany')
            break

          case 'findOne':
            // this.repository.findOne() → this.prisma.model.findUnique()
            callee.object = j.memberExpression(
              j.memberExpression(j.thisExpression(), j.identifier('prisma')),
              j.identifier(getModelNameFromContext(callPath) || 'model')
            )
            callee.property = j.identifier('findUnique')

            // Transform arguments - findOne({ where: { id } }) → findUnique({ where: { id } })
            transformFindOneArguments(call.arguments)
            break

          case 'findOneBy':
            // this.repository.findOneBy({ id }) → this.prisma.model.findUnique({ where: { id } })
            callee.object = j.memberExpression(
              j.memberExpression(j.thisExpression(), j.identifier('prisma')),
              j.identifier(getModelNameFromContext(callPath) || 'model')
            )
            callee.property = j.identifier('findUnique')

            // Wrap the criteria object in a where property
            if (call.arguments.length > 0) {
              call.arguments[0] = j.objectExpression([
                j.property('init', j.identifier('where'), call.arguments[0]),
              ])
            }
            break

          case 'findBy':
            // this.repository.findBy({ isActive: true }) → this.prisma.model.findMany({ where: { isActive: true } })
            callee.object = j.memberExpression(
              j.memberExpression(j.thisExpression(), j.identifier('prisma')),
              j.identifier(getModelNameFromContext(callPath) || 'model')
            )
            callee.property = j.identifier('findMany')

            // Wrap the criteria object in a where property
            if (call.arguments.length > 0) {
              call.arguments[0] = j.objectExpression([
                j.property('init', j.identifier('where'), call.arguments[0]),
              ])
            }
            break

          case 'save':
            // this.repository.save(entity) → this.prisma.model.create/update()
            callee.object = j.memberExpression(
              j.memberExpression(j.thisExpression(), j.identifier('prisma')),
              j.identifier(getModelNameFromContext(callPath) || 'model')
            )

            // Add comment about potential manual review - save could be create or update
            j(callPath).insertBefore(
              j.commentLine(
                ' NOTE: TypeORM `save` could be either create or update. Verify correct behavior.'
              )
            )

            // Determine if this is a create or update operation based on context
            // This is a heuristic and might need manual adjustment
            let hasIdProperty = false
            if (
              call.arguments.length === 1 &&
              call.arguments[0].type === 'ObjectExpression'
            ) {
              const objProperties = call.arguments[0].properties
              for (const prop of objProperties) {
                if (
                  prop.key.name === 'id' &&
                  prop.value.type !== 'NullLiteral' &&
                  prop.value.value !== undefined
                ) {
                  hasIdProperty = true
                  break
                }
              }
            }

            if (hasIdProperty) {
              // If entity has ID, it's likely an update
              callee.property = j.identifier('update')
              // Update requires where clause with ID
              const dataObj = call.arguments[0]
              let idValue = null

              // Find and extract the id property
              const idPropIndex = dataObj.properties.findIndex(
                (p) => p.key.name === 'id'
              )
              if (idPropIndex !== -1) {
                idValue = dataObj.properties[idPropIndex].value
                // Remove id from data properties to avoid Prisma validation error
                dataObj.properties.splice(idPropIndex, 1)
              }

              call.arguments[0] = j.objectExpression([
                j.property(
                  'init',
                  j.identifier('where'),
                  j.objectExpression([
                    j.property('init', j.identifier('id'), idValue),
                  ])
                ),
                j.property('init', j.identifier('data'), dataObj),
              ])
            } else {
              // If no ID, it's a create operation
              callee.property = j.identifier('create')

              // If only one argument and it's an object, wrap it in data property
              if (
                call.arguments.length === 1 &&
                call.arguments[0].type === 'ObjectExpression'
              ) {
                call.arguments[0] = j.objectExpression([
                  j.property('init', j.identifier('data'), call.arguments[0]),
                ])
              }
            }
            break

          case 'update':
            // this.repository.update(id, data) → this.prisma.model.update({ where: { id }, data })
            callee.object = j.memberExpression(
              j.memberExpression(j.thisExpression(), j.identifier('prisma')),
              j.identifier(getModelNameFromContext(callPath) || 'model')
            )
            callee.property = j.identifier('update')

            // Transform arguments from (id, data) to { where: { id }, data }
            if (call.arguments.length >= 2) {
              const idArg = call.arguments[0]
              const dataArg = call.arguments[1]

              call.arguments = [
                j.objectExpression([
                  j.property(
                    'init',
                    j.identifier('where'),
                    j.objectExpression([
                      j.property('init', j.identifier('id'), idArg),
                    ])
                  ),
                  j.property('init', j.identifier('data'), dataArg),
                ]),
              ]
            }
            break

          case 'delete':
          case 'remove':
            // this.repository.delete(id) → this.prisma.model.delete({ where: { id } })
            callee.object = j.memberExpression(
              j.memberExpression(j.thisExpression(), j.identifier('prisma')),
              j.identifier(getModelNameFromContext(callPath) || 'model')
            )
            callee.property = j.identifier('delete')

            // Transform arguments
            transformDeleteArguments(call.arguments)
            break

          case 'count':
            // this.repository.count() → this.prisma.model.count()
            callee.object = j.memberExpression(
              j.memberExpression(j.thisExpression(), j.identifier('prisma')),
              j.identifier(getModelNameFromContext(callPath) || 'model')
            )
            callee.property = j.identifier('count')

            // If argument is an object but not wrapped in 'where', add it
            if (
              call.arguments.length > 0 &&
              call.arguments[0].type === 'ObjectExpression'
            ) {
              const hasWhere = call.arguments[0].properties.some(
                (p) => p.key.name === 'where' || p.key.value === 'where'
              )

              if (!hasWhere) {
                call.arguments[0] = j.objectExpression([
                  j.property('init', j.identifier('where'), call.arguments[0]),
                ])
              }
            }
            break

          case 'createQueryBuilder':
            // Query builders require more complex transformation to Prisma
            // Mark for manual review
            // Add a comment indicating this needs manual attention
            j(callPath).insertBefore(
              j.commentLine(
                ' TODO: Replace TypeORM query builder with Prisma equivalent - manual conversion needed'
              )
            )

            // Add example of how to replace query builder with Prisma
            j(callPath).insertBefore(
              j.commentBlock(`
 Example Prisma replacement for query builder:
 
 TypeORM:
 const users = await this.repository
   .createQueryBuilder('user')
   .leftJoinAndSelect('user.profile', 'profile')
   .where('user.isActive = :isActive', { isActive: true })
   .getMany();
 
 Prisma:
 const users = await this.prisma.user.findMany({
   where: {
     isActive: true
   },
   include: {
     profile: true
   }
 });
`)
            )
            break

          // Add more TypeORM methods as needed
        }

        fileChanged.services = true
      }
    })
  }

  // Helper function to transform findOne arguments
  function transformFindOneArguments(args) {
    if (args.length === 0) return

    const firstArg = args[0]
    if (firstArg.type !== 'ObjectExpression') return

    // Check if it already has a where property
    const whereProperty = firstArg.properties.find(
      (p) => p.key.name === 'where' || p.key.value === 'where'
    )

    if (!whereProperty) {
      // findOne({ id: 1 }) → findUnique({ where: { id: 1 } })
      // Collect non-where properties
      const criteria = firstArg.properties.filter(
        (p) =>
          !['relations', 'select', 'order', 'skip', 'take'].includes(
            p.key.name || p.key.value
          )
      )

      // If we have criteria properties, create a where object
      if (criteria.length > 0) {
        const whereObj = j.objectExpression(criteria)
        firstArg.properties = firstArg.properties.filter((p) =>
          ['relations', 'select', 'order', 'skip', 'take'].includes(
            p.key.name || p.key.value
          )
        )
        firstArg.properties.push(
          j.property('init', j.identifier('where'), whereObj)
        )
      }
    }

    // Transform relations to include
    transformRelationsToInclude(firstArg)
  }

  // Helper function to transform delete/remove arguments
  function transformDeleteArguments(args) {
    if (args.length === 0) return

    const firstArg = args[0]

    // If ID is passed directly (delete(1)), wrap it in where object
    if (
      firstArg.type === 'NumericLiteral' ||
      firstArg.type === 'StringLiteral' ||
      firstArg.type === 'Identifier'
    ) {
      args[0] = j.objectExpression([
        j.property(
          'init',
          j.identifier('where'),
          j.objectExpression([j.property('init', j.identifier('id'), firstArg)])
        ),
      ])
    }
    // If object criteria is passed, wrap in where
    else if (firstArg.type === 'ObjectExpression') {
      args[0] = j.objectExpression([
        j.property('init', j.identifier('where'), firstArg),
      ])
    }
  }

  // Helper function to transform relations to include
  function transformRelationsToInclude(options) {
    if (options.type !== 'ObjectExpression') return

    const relationsProperty = options.properties.find(
      (p) => p.key.name === 'relations' || p.key.value === 'relations'
    )

    if (relationsProperty) {
      // Replace relations with include
      relationsProperty.key = j.identifier('include')

      // If it's a deep relation object, transform its structure
      if (relationsProperty.value.type === 'ObjectExpression') {
        relationsProperty.value.properties.forEach((relationProp) => {
          // TypeORM: { relations: { user: true } }
          // Prisma: { include: { user: true } }
          // No change needed for this format
        })
      }
    }
  }

  // Try to determine the model name from context
  function getModelNameFromContext(path) {
    // Look for clues in variable names, method names, etc.
    // This is a heuristic and might need manual adjustment

    // First, check if we're inside a class that might have the model name
    let className = null
    let ancestors = path.ancestors()

    for (const ancestor of ancestors) {
      if (ancestor.node.type === 'ClassDeclaration' && ancestor.node.id) {
        className = ancestor.node.id.name

        // Common patterns like UserService, UserController
        const serviceMatch = className.match(
          /(.+)(Service|Controller|Repository)$/
        )
        if (serviceMatch) {
          return serviceMatch[1]
        }

        break
      }
    }

    // Check the object the repository is accessed from
    if (
      path.node.callee.type === 'MemberExpression' &&
      path.node.callee.object.type === 'MemberExpression'
    ) {
      const repositoryObj = path.node.callee.object

      if (
        repositoryObj.property.type === 'Identifier' &&
        repositoryObj.property.name === 'repository' &&
        repositoryObj.object.type === 'ThisExpression'
      ) {
        // Look for property initialization in the class
        if (className) {
          const classDeclaration = root
            .find(j.ClassDeclaration, { id: { name: className } })
            .at(0)

          if (classDeclaration.size() > 0) {
            // Look for repository property and its type
            const properties = j(classDeclaration)
              .find(j.ClassProperty)
              .filter((prop) => {
                return (
                  prop.node.key.type === 'Identifier' &&
                  prop.node.key.name === 'repository' &&
                  prop.node.typeAnnotation
                )
              })

            if (properties.size() > 0) {
              const typeAnnotation =
                properties.get().node.typeAnnotation.typeAnnotation

              if (
                typeAnnotation.type === 'TSTypeReference' &&
                typeAnnotation.typeName.name === 'Repository' &&
                typeAnnotation.typeParameters &&
                typeAnnotation.typeParameters.params.length > 0
              ) {
                const entityTypeParam = typeAnnotation.typeParameters.params[0]
                if (entityTypeParam.type === 'TSTypeReference') {
                  return entityTypeParam.typeName.name
                }
              }
            }
          }
        }
      }
    }

    return null
  }

  // Transform TypeORM module imports to Prisma
  function transformModuleImports() {
    // Find TypeORM imports and replace with Prisma
    root.find(j.ImportDeclaration).forEach((path) => {
      const importDecl = path.node
      const source = importDecl.source.value

      if (source === 'typeorm') {
        // Check for specific imports from typeorm
        const specifiers = importDecl.specifiers
        const hasRepositoryImport = specifiers.some(
          (s) =>
            s.type === 'ImportSpecifier' && s.imported.name === 'Repository'
        )

        const hasEntityImport = specifiers.some(
          (s) => s.type === 'ImportSpecifier' && s.imported.name === 'Entity'
        )

        // If importing Repository, replace with PrismaService
        if (hasRepositoryImport) {
          // Add PrismaService import
          root
            .get()
            .node.program.body.unshift(
              j.importDeclaration(
                [j.importSpecifier(j.identifier('PrismaService'))],
                j.stringLiteral('./prisma.service')
              )
            )

          // Filter out Repository from typeorm imports
          importDecl.specifiers = specifiers.filter(
            (s) =>
              !(
                s.type === 'ImportSpecifier' &&
                ['Repository', 'getRepository'].includes(s.imported.name)
              )
          )

          fileChanged.modules = true
        }

        // If importing Entity, it might be replaced entirely when using Prisma schema
        if (hasEntityImport) {
          // Filter out Entity and other schema decorators from typeorm imports
          importDecl.specifiers = specifiers.filter(
            (s) =>
              !(
                s.type === 'ImportSpecifier' &&
                [
                  'Entity',
                  'Column',
                  'PrimaryColumn',
                  'PrimaryGeneratedColumn',
                  'CreateDateColumn',
                  'UpdateDateColumn',
                  'DeleteDateColumn',
                  'OneToOne',
                  'ManyToOne',
                  'OneToMany',
                  'ManyToMany',
                  'JoinColumn',
                  'JoinTable',
                ].includes(s.imported.name)
              )
          )

          fileChanged.modules = true
        }

        // If no specifiers left, remove the import entirely
        if (importDecl.specifiers.length === 0) {
          j(path).remove()
        }
      } else if (source.match(/typeorm\/repository/i)) {
        // Remove typeorm repository imports
        j(path).remove()
        fileChanged.modules = true
      } else if (source.endsWith('.entity') || source.includes('/entities/')) {
        // Entity imports might be used for type references
        // We'll keep them but add a comment for review
        j(path).insertBefore(
          j.commentLine(
            ' TODO: Review entity import - might need to use Prisma types instead'
          )
        )
      }
    })

    // Find TypeORM module imports in Nest.js modules
    root
      .find(j.CallExpression, {
        callee: {
          type: 'Identifier',
          name: 'forFeature',
        },
      })
      .forEach((path) => {
        // TypeOrmModule.forFeature([User, Profile]) → Replace with PrismaModule
        const parent = path.parent.node

        if (
          parent.type === 'MemberExpression' &&
          parent.object.type === 'Identifier' &&
          parent.object.name === 'TypeOrmModule'
        ) {
          // Replace TypeOrmModule.forFeature([...]) with PrismaModule
          parent.object.name = 'PrismaModule'
          delete parent.property
          path.parent.replace(j.identifier('PrismaModule'))

          // Make sure we import PrismaModule
          addPrismaModuleImport()

          fileChanged.modules = true
        }
      })

    // Find TypeOrmModule.forRoot() calls
    root
      .find(j.CallExpression, {
        callee: {
          type: 'MemberExpression',
          object: {
            type: 'Identifier',
            name: 'TypeOrmModule',
          },
          property: {
            type: 'Identifier',
            name: 'forRoot',
          },
        },
      })
      .forEach((path) => {
        // Replace TypeOrmModule.forRoot() with PrismaModule
        path.node.callee.object.name = 'PrismaModule'
        delete path.node.callee.property
        path.node.callee = j.identifier('PrismaModule')
        path.node.arguments = []

        // Make sure we import PrismaModule
        addPrismaModuleImport()

        fileChanged.modules = true
      })
  }

  // Helper to add PrismaModule import
  function addPrismaModuleImport() {
    // Check if we already have the import
    const existingImport = root.find(j.ImportDeclaration, {
      source: {
        value: './prisma/prisma.module',
      },
    })

    if (existingImport.size() === 0) {
      // Add import for PrismaModule
      root
        .get()
        .node.program.body.unshift(
          j.importDeclaration(
            [j.importSpecifier(j.identifier('PrismaModule'))],
            j.stringLiteral('./prisma/prisma.module')
          )
        )
    }
  }

  // Apply all transformations
  transformEntityClasses()
  transformRepositoryUsage()
  transformModuleImports()

  // Generate Prisma schema file content if we found entities
  if (
    Object.values(prismaSchemaFragments).length > 0 ||
    prismaModels.size > 0
  ) {
    // This would be created as a separate file, but we'll log it for now
    let prismaSchema = `// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql" // Change to your actual database provider
  url      = env("DATABASE_URL")
}

`

    // Add all enums first
    prismaEnums.forEach((enumDef) => {
      prismaSchema += enumDef + '\n'
    })

    // Then add all models
    prismaModels.forEach((modelDef) => {
      prismaSchema += modelDef + '\n'
    })

    // Log schema creation - in actual implementation, this would create a file
    console.log('Generated Prisma schema:', prismaSchema)
  }

  // Return transformed source
  if (
    fileChanged.entities ||
    fileChanged.repositories ||
    fileChanged.modules ||
    fileChanged.services
  ) {
    // If any transformations were applied, return the modified source
    return root.toSource()
  }

  // Otherwise, return the original source
  return fileInfo.source
}
