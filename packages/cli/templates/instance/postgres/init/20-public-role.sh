#!/bin/sh
# Runs once, when the data volume is first initialised, after 10-roles.sh. Creates the
# read-only role the processes that only read connect as: the last line
# of defence if any of their hardening is ever bypassed. Tables do not exist yet at this
# point (migrations run later, as the owner role), so the grant is a default privilege
# that applies to every table the owner role creates from now on.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
create role manablox_public login password '$POSTGRES_PUBLIC_PASSWORD';
grant connect on database "$POSTGRES_DB" to manablox_public;
grant usage on schema public to manablox_public;
grant select on all tables in schema public to manablox_public;
alter default privileges for role "${DATABASE_OWNER_USER:-manablox_owner}" in schema public
  grant select on tables to manablox_public;
SQL
