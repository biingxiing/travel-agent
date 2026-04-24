#!/usr/bin/env sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ENV_TEMPLATE="${ROOT_DIR}/.env.example"
ENV_FILE="${ROOT_DIR}/.env"

if [ ! -f "${ENV_FILE}" ]; then
  cp "${ENV_TEMPLATE}" "${ENV_FILE}"
fi

read_var() {
  key="$1"
  if grep -q "^${key}=" "${ENV_FILE}"; then
    grep "^${key}=" "${ENV_FILE}" | head -n 1 | cut -d= -f2-
  fi
}

replace_var() {
  key="$1"
  value="$2"

  if grep -q "^${key}=" "${ENV_FILE}"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "${ENV_FILE}"
  else
    printf '\n%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

generate_hex() {
  openssl rand -hex 32
}

generated_password=""
generated_cookie_secret=""

current_password=$(read_var AUTH_PASSWORD || true)
if [ -z "${current_password}" ] || [ "${current_password}" = "change-this-password" ]; then
  generated_password=$(generate_hex)
  replace_var AUTH_PASSWORD "${generated_password}"
fi

current_cookie_secret=$(read_var AUTH_COOKIE_SECRET || true)
if [ -z "${current_cookie_secret}" ] || [ "${current_cookie_secret}" = "replace-with-a-long-random-secret" ]; then
  generated_cookie_secret=$(generate_hex)
  replace_var AUTH_COOKIE_SECRET "${generated_cookie_secret}"
fi

rm -f "${ENV_FILE}.bak"

public_port=$(read_var PUBLIC_HTTP_PORT || true)
if [ -z "${public_port}" ]; then
  public_port=8080
fi

printf 'Prepared %s\n' "${ENV_FILE}"

if [ -n "${generated_password}" ]; then
  printf 'Generated AUTH_PASSWORD=%s\n' "${generated_password}"
else
  printf 'AUTH_PASSWORD kept as-is\n'
fi

if [ -n "${generated_cookie_secret}" ]; then
  printf 'Generated AUTH_COOKIE_SECRET=%s\n' "${generated_cookie_secret}"
else
  printf 'AUTH_COOKIE_SECRET kept as-is\n'
fi

current_api_key=$(read_var OPENAI_API_KEY || true)
if [ -z "${current_api_key}" ] || [ "${current_api_key}" = "your-api-key-here" ]; then
  printf 'Next step: edit .env and set OPENAI_API_KEY\n'
fi

printf 'Then run: docker compose up --build -d\n'
printf 'Primary URL: http://localhost:%s\n' "${public_port}"
