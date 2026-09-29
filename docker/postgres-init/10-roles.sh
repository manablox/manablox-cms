#!/bin/sh
# Runs once, when the Postgres data directory is created. The owner role owns the database
# and its schema and runs the migrations; the app role logs in for the CMS and owns nothing.
# The migrations grant the app role its rights.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner="${DATABASE_OWNER_USER:-manablox_owner}" \
  -v owner_password="$DATABASE_OWNER_PASSWORD" \
  -v app="${DATABASE_APP_USER:-manablox_app}" \
  -v app_password="$DATABASE_APP_PASSWORD" \
  -v db="$POSTGRES_DB" <<'SQL'
create role :"owner" login password :'owner_password';
create role :"app" login password :'app_password';
alter database :"db" owner to :"owner";
alter schema public owner to :"owner";
SQL
