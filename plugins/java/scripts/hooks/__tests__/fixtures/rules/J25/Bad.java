package demo;

class Bad {

    // expect-next: J25
    Bad() {
    }

    // expect-next: J25
    void reset() {

    }

    /** Does nothing: a Javadoc outside the body doesn't explain the empty body. */
    // expect-next: J25
    void close() {
    }

    Runnable task() {
        return new Runnable() {
            @Override
            // expect-next: J25
            public void run() {
            }
        };
    }

}
