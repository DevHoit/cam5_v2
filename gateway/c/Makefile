# cam5-gateway — gateway HoitLive Core en C (SIM7600 OpenLinux y Linux en general)
#
#   make                       binario nativo con TLS (OpenSSL del sistema)
#   make OPENSSL_DIR=/ruta     OpenSSL en otra ubicación (incluye include/ y lib/)
#   make TLS=none              sin TLS: solo para pruebas contra http://localhost
#   make check                 compila con -Werror (lo que corre en CI)
#   make asan                  binario con AddressSanitizer/UBSan para pruebas
#   make sim7600 SDK_SYSROOT=… cross-compile ARMv7 con el SDK de SIMCom
#
# Para SIM7600 ver README.md, sección «Compilar para el SIM7600SA-H».

CC        ?= cc
STRIP     ?= strip
TLS       ?= openssl
OPTFLAGS  ?= -O2
CFLAGS    += -std=c99 $(OPTFLAGS) -Wall -Wextra -Wpedantic -Wshadow -Wformat=2 -Wstrict-prototypes -Wmissing-prototypes -Wno-missing-field-initializers
LDLIBS    ?=

SRC = src/main.c src/util.c src/json.c src/modbus.c src/http.c src/queue.c
HDR = $(wildcard src/*.h)
BIN = cam5-gateway

ifeq ($(TLS),openssl)
  CFLAGS += -DCAM5_TLS_OPENSSL
  ifneq ($(OPENSSL_DIR),)
    CFLAGS  += -I$(OPENSSL_DIR)/include
    LDFLAGS += -L$(OPENSSL_DIR)/lib
  endif
  # Para enlazar OpenSSL estático: make OPENSSL_LIBS="/ruta/libssl.a /ruta/libcrypto.a -ldl -lpthread"
  OPENSSL_LIBS ?= -lssl -lcrypto
  LDLIBS += $(OPENSSL_LIBS)
endif

$(BIN): $(SRC) $(HDR) Makefile
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $(SRC) $(LDLIBS)

.PHONY: check asan clean sim7600 install test

TEST_SRC = tests/unit_tests.c src/util.c src/json.c src/queue.c
test: $(TEST_SRC) $(HDR)
	$(CC) $(CFLAGS) -Werror -o tests/unit_tests $(TEST_SRC)
	./tests/unit_tests

check: CFLAGS += -Werror
check: clean $(BIN)

asan: OPTFLAGS = -O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer
asan: LDFLAGS += -fsanitize=address,undefined
asan: clean $(BIN)

# SDK de SIMCom (Yocto, glibc). Forma recomendada: cargar el entorno del SDK,
# que define CC con -march, -mfloat-abi y --sysroot correctos, y luego
#   make sim7600
# Sin el script de entorno: make sim7600 CROSS_COMPILE=arm-oe-linux-gnueabi- SDK_SYSROOT=/ruta/sysroot
CROSS_COMPILE ?= arm-oe-linux-gnueabi-
SDK_SYSROOT   ?=
sim7600:
	$(MAKE) clean
	@if [ -n "$(SDK_SYSROOT)" ]; then \
	    $(MAKE) CC="$(CROSS_COMPILE)gcc --sysroot=$(SDK_SYSROOT)" OPTFLAGS=-Os $(BIN); \
	else \
	    case "$(CC)" in *arm*) ;; *) echo "Carga el entorno del SDK (source environment-setup-…) o define SDK_SYSROOT"; exit 1;; esac; \
	    $(MAKE) OPTFLAGS=-Os $(BIN); \
	fi
	$(CROSS_COMPILE)strip $(BIN)
	@file $(BIN) 2>/dev/null || true

PREFIX ?= /usr/bin
install: $(BIN)
	install -m 0755 $(BIN) $(DESTDIR)$(PREFIX)/$(BIN)

clean:
	rm -f $(BIN) tests/unit_tests
