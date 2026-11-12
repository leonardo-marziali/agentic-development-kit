package demo;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

class Bad {
    private static final Logger log = LoggerFactory.getLogger(Bad.class); // expect: S2
}
