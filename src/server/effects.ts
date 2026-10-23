/**
 * Side effects (emails) collected during a transaction and run only after it
 * commits, so a rolled-back booking never sends a "you're booked" email.
 */
export class Effects {
  private jobs: Array<() => Promise<void>> = [];
  add(job: () => Promise<void>) {
    this.jobs.push(job);
  }
  async flush() {
    const jobs = this.jobs.splice(0);
    await Promise.allSettled(jobs.map((j) => j()));
  }
}
