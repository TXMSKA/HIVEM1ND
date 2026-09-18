# Address ranges

The addresses a server-side fetch of a URL taken from input must never connect to, and how the check is placed so that the address checked is the address connected to. The build line is in [categories/outbound.md](categories/outbound.md) and the proof in [outbound-requests](protocols/outbound-requests.md). The ranges were read from the IANA special-purpose registries and the address space registries on 2026-09-18; the registries grow, so a pass fetches them again rather than trusting this copy.

## Where the check sits

1. **A host allowlist first.** The destination host is on a configured list, the scheme is `https`, the port is the expected one and the URL carries no credentials. The address check below runs as well, because an allowed name can be pointed at an internal address.
2. **Every resolved address is checked, A and AAAA records alike.** The published guidance resolves all the records behind a name and applies the same check to each.
3. **The check runs inside the connection's own address lookup.** A check made on a first resolution and followed by a connection that resolves again can be answered differently the second time, which is how rebinding works. Placing the check in the lookup function the connection uses, or connecting to the exact address that was checked, closes that gap.
4. **Literal addresses skip the lookup.** A URL whose host is already an address is connected to without calling the lookup function at all, which was confirmed on one runtime's HTTP client on 2026-09-18. Literals are refused outright, or parsed with a real address parser and checked separately. Decimal, octal, hexadecimal and mixed notations of the same address are part of that parse.
5. **Redirects are not followed automatically.** Each hop is followed by hand, a small fixed number of times, and every hop goes through steps 1 to 4 again.
6. **Mapped and embedded IPv4 addresses are unwrapped.** An IPv4-mapped IPv6 address, such as `::ffff:127.0.0.1`, is converted to its IPv4 form and checked against the IPv4 list. One runtime's address list class, holding the whole mapped block `::ffff:0:0/96`, matched every IPv4 address checked and refused all traffic; the opposite mistake, a list that never unwraps, lets the mapped form of a loopback address through. Both directions are tested.

## IPv4

| Block | Name |
| --- | --- |
| `0.0.0.0/8` | This network |
| `10.0.0.0/8` | Private use |
| `100.64.0.0/10` | Shared address space |
| `127.0.0.0/8` | Loopback |
| `169.254.0.0/16` | Link local, which holds the cloud metadata address `169.254.169.254` |
| `172.16.0.0/12` | Private use |
| `192.0.0.0/24` | IETF protocol assignments |
| `192.0.2.0/24` | Documentation |
| `192.31.196.0/24` | AS112 |
| `192.52.193.0/24` | AMT |
| `192.88.99.0/24` | Deprecated 6to4 relay anycast |
| `192.168.0.0/16` | Private use |
| `192.175.48.0/24` | Direct delegation AS112 |
| `198.18.0.0/15` | Benchmarking |
| `198.51.100.0/24` | Documentation |
| `203.0.113.0/24` | Documentation |
| `224.0.0.0/4` | Multicast, from the IPv4 address space registry |
| `240.0.0.0/4` | Reserved |
| `255.255.255.255/32` | Limited broadcast |

## IPv6

| Block | Name |
| --- | --- |
| `::/128` | Unspecified |
| `::1/128` | Loopback |
| `::ffff:0:0/96` | IPv4-mapped, unwrapped and checked as IPv4 |
| `64:ff9b::/96` | IPv4-IPv6 translation |
| `64:ff9b:1::/48` | IPv4-IPv6 translation |
| `100::/64` | Discard only |
| `2001::/23` | IETF protocol assignments, which holds Teredo `2001::/32` and benchmarking `2001:2::/48` |
| `2001:db8::/32` | Documentation |
| `2002::/16` | 6to4, which embeds an IPv4 address |
| `2620:4f:8000::/48` | Direct delegation AS112 |
| `3fff::/20` | Documentation |
| `5f00::/16` | Segment routing identifiers |
| `fc00::/7` | Unique local |
| `fe80::/10` | Link-local unicast |
| `fec0::/10` | Former site-local, deprecated, from the IPv6 address space registry |
| `ff00::/8` | Multicast, from the IPv6 address space registry |

## Names

Cloud metadata services are also reached by name, such as `metadata.google.internal`, which the published guidance lists beside the address. A name on the host allowlist never resolves to one of the blocks above; a name that does is refused at connection time by step 3, not trusted because it was allowed.

Sources: https://www.iana.org/assignments/iana-ipv4-special-registry/, https://www.iana.org/assignments/iana-ipv6-special-registry/, https://www.iana.org/assignments/ipv4-address-space/, https://www.iana.org/assignments/ipv6-address-space/, https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
