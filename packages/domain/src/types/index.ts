export {
  parseObjectType,
  InvalidTypeError,
  PROPERTY_KINDS,
  relationTypes,
  relationTypesText,
} from './property-def.ts';
export type { ObjectType, PropertyDef, PropertyKind } from './property-def.ts';
export {
  isWikiLink,
  relationTargets,
  relationTypeRefusal,
  validatePropertyValue,
} from './property-value.ts';
export { linkedNotes, withLink, withoutLink } from './relation-links.ts';
export { objectTypeIcon, TYPE_ICONS } from './type-icon.ts';
export {
  freePropertyKey,
  isViewColumn,
  propertyKeyProblem,
  slugifyName,
  typeNameProblem,
} from './type-name.ts';
export {
  addOption,
  applyTypeEdit,
  addProperty,
  changePropertyKind,
  moveOption,
  moveProperty,
  NEW_PROPERTY_LABEL,
  newObjectType,
  optionTone,
  removeOption,
  removeProperty,
  renameOption,
  renameProperty,
  setDoneOption,
  setOptionColor,
  setPropertyRequired,
  setRelation,
  setTypeIcon,
  setTypeLabel,
  TypeEditError,
} from './type-edit.ts';
export type { TypeChange, TypeEdit } from './type-edit.ts';
export {
  newTypeFrontmatter,
  propertySpec,
  typeFrontmatter,
  typeFrontmatterChanges,
} from './type-frontmatter.ts';
export { holdsTypeValues, migrationChanges, valuesThatWontFit } from './note-migration.ts';
export type { NoteMigration } from './note-migration.ts';
export { isDoneValue, statusOf, statusToRemember, untickedValue } from './status-property.ts';
export type { StatusProperty } from './status-property.ts';
export { holdsLinks, linkedNames, noteNames, withNoteNames } from './relation-names.ts';
export type { LinkedName, NamedNote, NoteNames } from './relation-names.ts';
export {
  declaredTypeName,
  isBuiltInType,
  isBuiltInTypeFile,
  typeDeleteRefusal,
} from './built-in-types.ts';
