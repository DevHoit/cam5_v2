/*
 * compat.h — macros de plataforma. Debe incluirse antes que cualquier cabecera
 * del sistema para que el código compile igual en glibc (SIM7600 OpenLinux),
 * musl y macOS.
 */
#ifndef CAM5_COMPAT_H
#define CAM5_COMPAT_H

#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif
#ifndef _DEFAULT_SOURCE
#define _DEFAULT_SOURCE 1
#endif
#ifndef _DARWIN_C_SOURCE
#define _DARWIN_C_SOURCE 1
#endif
/* En ARM de 32 bits (SIM7600) readdir y stat necesitan la interfaz de 64 bits:
 * sin ella fallan con EOVERFLOW en sistemas de archivos con inodos grandes. */
#ifndef _FILE_OFFSET_BITS
#define _FILE_OFFSET_BITS 64
#endif
/* time_t de 64 bits en glibc 2.34+ de 32 bits (año 2038); las glibc
 * anteriores ignoran la macro. */
#ifndef _TIME_BITS
#define _TIME_BITS 64
#endif

#define CAM5_VERSION "1.2.0"

#if defined(__GNUC__) || defined(__clang__)
#define CAM5_PRINTF(fmt, args) __attribute__((format(printf, fmt, args)))
#else
#define CAM5_PRINTF(fmt, args)
#endif

#endif
