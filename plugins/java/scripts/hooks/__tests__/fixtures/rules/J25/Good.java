package demo;

abstract class Good implements AutoCloseable {

    Good() {
        // Framework constructor: the fields are injected after construction.
    }

    @Override
    public void close() {

        /* Nothing to release: the connection pool is owned by the container. */
    }

    abstract void map();

    void work() {
        System.out.println("busy");
    }

    interface Hook {

        void before();

        default void after() {
            // Optional hook: implementations override it when they need it.
        }

    }

}
