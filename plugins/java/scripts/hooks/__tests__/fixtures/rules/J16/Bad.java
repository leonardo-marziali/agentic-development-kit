package demo;

import java.util.*; // expect: J16
import static java.util.Objects.*; // expect: J16
import java.time.Instant;

class Bad {
    List<Instant> instants = new ArrayList<>();
}
